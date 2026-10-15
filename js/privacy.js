// Cosmetic layer only. The camera must deliver the permanently masked picture.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

// Preserve the approved photograph's hue. No RGB white balance,
// no automatic monochrome/IR inference, and no light-dependent desaturation.
export const PHOTO_CORRECTION = Object.freeze({ gain: Object.freeze([1, 1, 1]), saturation: .97 });

export function estimateBrightness(frame, region, config, mix = 0) {
  if (!region.samples?.length) return 1;
  const ratios = [];
  for (const sample of region.samples) {
    const current = sampleMean(frame, sample, config.width, config.height);
    const actual = luminance(current.rgb);
    const reference = luminance(sample.reference.map((value, c) => value * (1 - mix) + (sample.nightReference ?? sample.reference)[c] * mix));
    // Very dark, clipped or inconsistent references are not reliable light meters.
    if (actual < 20 || actual > 235 || reference < 20 || current.black > .1) return null;
    ratios.push(actual / reference);
  }
  if (Math.max(...ratios) / Math.min(...ratios) > 1.35) return null;
  return clamp(ratios.reduce((sum, value) => sum + value, 0) / ratios.length, .9, 1.1);
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const smoothstep = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

export function estimateNightMix(frame, config) {
  if (!config.skySamples?.length) return 0;
  const wall = config.regions.flatMap(region => region.samples ?? []);
  if (!wall.length) return null;
  const currentWall = median(wall.map(sample => luminance(sampleMean(frame, sample, config.width, config.height).rgb)));
  if (currentWall < 12 || currentWall > 245) return null;
  const currentSky = median(config.skySamples.map(sample => luminance(sampleMean(frame, sample, config.width, config.height).rgb)));
  const referenceRatio = key => median(config.skySamples.map(sample => luminance(sample[key]))) /
    Math.max(1, median(wall.map(sample => luminance(sample[key]))));
  const day = referenceRatio('reference'), night = referenceRatio('nightReference');
  if (!Number.isFinite(day + night) || day <= night) return null;
  const low = night + .08 * (day - night), high = night + .6 * (day - night);
  return 1 - smoothstep((currentSky / currentWall - low) / (high - low));
}

// First valid reading is immediate. Later changes must persist for six 500ms
// samples, then move gradually. A brief headlight/flash cannot switch profiles.
export function advanceScene(state, target) {
  if (target === null || !Number.isFinite(target)) { state.count = 0; return state.mix; }
  target = clamp(target, 0, 1);
  if (state.mix === null) { state.mix = target; state.count = 0; return target; }
  if (Math.abs(target - state.mix) < .025) {
    if (state.count >= 6) state.mix = target;
    state.count = 0; return state.mix;
  }
  if (state.candidate === undefined || Math.abs(target - state.candidate) > .08) state.count = 0;
  state.candidate = target;
  if (++state.count >= 6) {
    state.mix += .15 * (target - state.mix);
    if (Math.abs(target - state.mix) < .01) state.mix = target;
  }
  return state.mix;
}

// Blend RGB in one opaque layer, never two partially transparent overlays.
export function mixPatches(day, night, mix, gain, destination = new Uint8ClampedArray(day.length)) {
  for (let i = 0; i < day.length; i += 4) {
    const rgb = [0, 1, 2].map(c => day[i + c] * (1 - mix) + night[i + c] * mix);
    const safeGain = Math.min(gain, 255 / Math.max(1, ...rgb));
    for (let c = 0; c < 3; c++) destination[i + c] = rgb[c] * safeGain;
    destination[i + 3] = day[i + 3];
  }
  return destination;
}

export function tintPatch(source, correction) {
  const result = new Uint8ClampedArray(source);
  for (let i = 0; i < result.length; i += 4) {
    if (!source[i + 3]) continue;
    const rgb = [0, 1, 2].map(c => source[i + c] * correction.gain[c]);
    const gray = luminance(rgb);
    for (let c = 0; c < 3; c++) result[i + c] = clamp(gray + (rgb[c] - gray) * correction.saturation, 0, 255);
    // Alpha is immutable: correction must never make the patch translucent.
  }
  return result;
}

export function sampleMean(frame, rect, sourceWidth, sourceHeight) {
  const sx = frame.width / sourceWidth, sy = frame.height / sourceHeight;
  const x0 = Math.max(0, Math.ceil(rect.x * sx)), y0 = Math.max(0, Math.ceil(rect.y * sy));
  const x1 = Math.min(frame.width, Math.floor((rect.x + rect.width) * sx));
  const y1 = Math.min(frame.height, Math.floor((rect.y + rect.height) * sy));
  const sum = [0, 0, 0]; let count = 0, black = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * frame.width + x) * 4;
    for (let c = 0; c < 3; c++) sum[c] += frame.data[i + c];
    if (Math.max(frame.data[i], frame.data[i + 1], frame.data[i + 2]) < 24) black++;
    count++;
  }
  return { rgb: sum.map(v => count ? v / count : 0), black: count ? black / count : 0 };
}

export function analyzeFrame(frame, config) {
  return config.regions.map(region => {
    const core = { x: region.x + 5, y: region.y + 5, width: region.width - 10, height: region.height - 10 };
    if (sampleMean(frame, core, config.width, config.height).black < .95) return null;
    return PHOTO_CORRECTION;
  });
}

export function createPrivacyLayer({ video, canvas, config, document: doc = document, timers = globalThis }) {
  let active = false, ready = false, timer = null, destroyed = false;
  let patches = [];
  let failed = false;
  const scene = { mix: null, count: 0 };
  canvas.hidden = true;
  const output = canvas.getContext('2d');
  const probe = doc.createElement('canvas');
  probe.width = 512; probe.height = 288;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  if (!output || !probeContext) return { setActive() {}, destroy() {} };
  canvas.width = config.width; canvas.height = config.height;

  function stop(reason) {
    timers.clearTimeout(timer); timer = null;
    canvas.hidden = true;
    canvas.dataset.coverage = reason;
    scene.mix = null; scene.count = 0;
    for (const patch of patches) patch.brightness = null;
  }
  function tick() {
    timer = null;
    if (!active || !ready || destroyed || doc.hidden) { stop('inactive'); return; }
    if (!video.videoWidth || video.readyState < 2) { stop('waiting'); return; }
    if (Math.abs(video.videoWidth / video.videoHeight - config.width / config.height) > .005) {
      stop('format-mismatch'); return;
    }
    try {
      probeContext.drawImage(video, 0, 0, probe.width, probe.height);
      const frame = probeContext.getImageData(0, 0, probe.width, probe.height);
      const next = analyzeFrame(frame, config);
      const mix = advanceScene(scene, estimateNightMix(frame, config));
      if (mix === null) { canvas.hidden = true; timer = timers.setTimeout(tick, 500); return; }
      output.clearRect(0, 0, canvas.width, canvas.height);
      let visible = 0;
      next.forEach((value, i) => {
        if (!value) return;
        const patch = patches[i];
        const target = estimateBrightness(frame, config.regions[i], config, mix);
        if (target !== null) {
          patch.brightness = patch.brightness === null ? target : patch.brightness + .15 * (target - patch.brightness);
        }
        mixPatches(patch.day, patch.night, mix, patch.brightness ?? 1, patch.pixels.data);
        output.putImageData(patch.pixels, patch.x, patch.y);
        visible++;
      });
      canvas.hidden = visible === 0;
      canvas.dataset.coverage = visible === config.regions.length ? 'photographic' : 'partial-or-unmatched';
      canvas.dataset.profile = mix < .01 ? 'day' : mix > .99 ? 'night' : 'transition';
    } catch {
      // Tainted canvas/CORS, device limitations or decode failures must not break playback.
      stop('unavailable'); return;
    }
    timer = timers.setTimeout(tick, 500);
  }
  function refresh() {
    timers.clearTimeout(timer); timer = null;
    if (active && ready && !destroyed) tick();
  }
  const images = [], loaded = {};
  const profiles = [['day', config.artwork], ['night', config.nightArtwork ?? config.artwork]];
  function fail(reason) { failed = true; ready = false; stop(reason); }
  for (const [name, url] of profiles) {
    const image = doc.createElement('img');
    images.push(image);
    image.onload = () => {
      if (destroyed || failed) return;
      try {
        if (image.naturalWidth !== config.width || image.naturalHeight !== config.height) { fail('asset-mismatch'); return; }
        const source = doc.createElement('canvas');
        source.width = config.width; source.height = config.height;
        const context = source.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        loaded[name] = config.regions.map(region => {
          const x = Math.max(0, region.x - 16), y = Math.max(0, region.y - 16);
          const width = Math.min(config.width - x, region.width + 32);
          const height = Math.min(config.height - y, region.height + 32);
          return { x, y, width, height, data: tintPatch(context.getImageData(x, y, width, height).data, PHOTO_CORRECTION) };
        });
        if (!loaded.day || !loaded.night) return;
        patches = loaded.day.map((day, i) => {
          const night = loaded.night[i];
          for (let p = 3; p < day.data.length; p += 4) {
            if (day.data[p] !== night.data[p]) throw new Error('Profile alpha mismatch');
          }
          return { x: day.x, y: day.y, day: day.data, night: night.data,
            pixels: output.createImageData(day.width, day.height), brightness: null };
        });
        ready = true; refresh();
      } catch { fail('asset-unavailable'); }
    };
    image.onerror = () => fail('asset-unavailable');
    image.src = url;
  }
  for (const event of ['loadeddata', 'resize', 'playing']) video.addEventListener(event, refresh);
  doc.addEventListener('visibilitychange', refresh);
  return {
    setActive(value) {
      const changed = active !== value; active = value;
      if (!value) stop('inactive');
      else if (changed) refresh();
    },
    destroy() {
      destroyed = true; active = false; stop('destroyed');
      for (const image of images) { image.onload = null; image.onerror = null; }
      for (const event of ['loadeddata', 'resize', 'playing']) video.removeEventListener(event, refresh);
      doc.removeEventListener('visibilitychange', refresh);
    },
  };
}
