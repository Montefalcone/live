// Cosmetic layer only. The camera must deliver the permanently masked picture.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

// Preserve the approved photograph's hue. No RGB white balance,
// no automatic monochrome/IR inference, and no light-dependent desaturation.
export const PHOTO_CORRECTION = Object.freeze({ gain: Object.freeze([1, 1, 1]), saturation: .97 });

// One shared multiplier preserves RGB ratios. Limit the whole pixel before
// clipping, so bright colors never become white through separate channel clamps.
export function applyBrightness(source, gain, destination = new Uint8ClampedArray(source.length)) {
  for (let i = 0; i < source.length; i += 4) {
    const safeGain = Math.min(gain, 255 / Math.max(1, source[i], source[i + 1], source[i + 2]));
    for (let c = 0; c < 3; c++) destination[i + c] = source[i + c] * safeGain;
    destination[i + 3] = source[i + 3];
  }
  return destination;
}

export function estimateBrightness(frame, region, config) {
  if (!region.samples?.length) return 1;
  const ratios = [];
  for (const sample of region.samples) {
    const current = sampleMean(frame, sample, config.width, config.height);
    const actual = luminance(current.rgb), reference = luminance(sample.reference);
    // Very dark, clipped or inconsistent references are not reliable light meters.
    if (actual < 20 || actual > 235 || reference < 20 || current.black > .1) return null;
    ratios.push(actual / reference);
  }
  if (Math.max(...ratios) / Math.min(...ratios) > 1.35) return null;
  return clamp(ratios.reduce((sum, value) => sum + value, 0) / ratios.length, .65, 1.65);
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
      output.clearRect(0, 0, canvas.width, canvas.height);
      let visible = 0;
      next.forEach((value, i) => {
        if (!value) return;
        const patch = patches[i];
        const target = estimateBrightness(frame, config.regions[i], config);
        if (target !== null) {
          patch.brightness = patch.brightness === null ? target : patch.brightness + .15 * (target - patch.brightness);
        }
        applyBrightness(patch.base, patch.brightness ?? 1, patch.pixels.data);
        output.putImageData(patch.pixels, patch.x, patch.y);
        visible++;
      });
      canvas.hidden = visible === 0;
      canvas.dataset.coverage = visible === config.regions.length ? 'photographic' : 'partial-or-unmatched';
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
  const image = doc.createElement('img');
  image.onload = () => {
    if (destroyed) return;
    try {
      if (image.naturalWidth !== config.width || image.naturalHeight !== config.height) { stop('asset-mismatch'); return; }
      const source = doc.createElement('canvas');
      source.width = config.width; source.height = config.height;
      const context = source.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      patches = config.regions.map(region => {
        const x = Math.max(0, region.x - 16), y = Math.max(0, region.y - 16);
        const width = Math.min(config.width - x, region.width + 32);
        const height = Math.min(config.height - y, region.height + 32);
        const pixels = output.createImageData(width, height);
        pixels.data.set(tintPatch(context.getImageData(x, y, width, height).data, PHOTO_CORRECTION));
        return { x, y, pixels, base: new Uint8ClampedArray(pixels.data), brightness: null };
      });
      ready = true; refresh();
    } catch { stop('asset-unavailable'); }
  };
  image.onerror = () => stop('asset-unavailable');
  image.src = config.artwork;
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
      image.onload = null; image.onerror = null;
      for (const event of ['loadeddata', 'resize', 'playing']) video.removeEventListener(event, refresh);
      doc.removeEventListener('visibilitychange', refresh);
    },
  };
}
