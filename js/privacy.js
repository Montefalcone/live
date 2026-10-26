// Cosmetic layer only. The camera must deliver the permanently masked picture.
import { prepareEdgeBlend, measureEdgeDeltas, updateEdgeDeltas, applyEdgeBlend } from './privacy-edge.js?v=2.24';
import { estimateSampleGain, prepareMaterials, advanceMaterialGain, applyMaterialGains, prepareRoofTexture, applyRoofTexture } from './privacy-materials.js?v=2.24';
import { prepareRoofGlare, applyRoofGlare } from './privacy-glare.js?v=2.24';
import { describeWeather, createWeatherSelector, blendWeatherPixels, weatherSamples } from './privacy-weather.js?v=2.24';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const luminance = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

// Preserve the approved apertures' hue. No global RGB white balance,
// no automatic monochrome/IR inference, and no light-dependent desaturation.
export const PHOTO_CORRECTION = Object.freeze({ gain: Object.freeze([1, 1, 1]), saturation: .97 });

export function estimateBrightness(frame, region, config, mix = 0) {
  if (!region.samples?.length) return 1;
  if (region.materials) return estimateSampleGain(frame, region.samples, config, mix, region);
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
    const r = day[i] * (1 - mix) + night[i] * mix;
    const g = day[i + 1] * (1 - mix) + night[i + 1] * mix;
    const b = day[i + 2] * (1 - mix) + night[i + 2] * mix;
    const safeGain = Math.min(gain, 255 / Math.max(1, r, g, b));
    destination[i] = r * safeGain; destination[i + 1] = g * safeGain; destination[i + 2] = b * safeGain;
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
  const result = config.regions.map(region => {
    const core = { x: region.x + 5, y: region.y + 5, width: region.width - 10, height: region.height - 10 };
    const checks = region.maskChecks ?? [core];
    if (!checks.length || checks.some(check => sampleMean(frame, check, config.width, config.height).black < .95)) return null;
    return PHOTO_CORRECTION;
  });
  if (config.requireAllMasks && result.some(value => !value)) return result.map(() => null);
  return result;
}

export function createPrivacyLayer({ video, canvas, config, document: doc = document, timers = globalThis, now = () => globalThis.performance?.now() ?? Date.now() }) {
  let active = false, ready = false, timer = null, destroyed = false;
  let patches = [];
  let failed = false;
  let weather = null, weatherTime = null;
  let availableProfiles = [], weatherWeights = {}, weatherKey = '';
  const optionalFailures = [], assetTimers = new Set();
  const scene = { mix: null, count: 0 };
  canvas.hidden = true;
  const output = canvas.getContext('2d');
  const probe = doc.createElement('canvas');
  probe.width = 512; probe.height = 288;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  const detail = doc.createElement('canvas');
  const detailContext = detail.getContext('2d', { willReadFrequently: true });
  if (!output || !probeContext) return { setActive() {}, destroy() {} };
  canvas.width = config.width; canvas.height = config.height;

  function stop(reason) {
    timers.clearTimeout(timer); timer = null;
    canvas.hidden = true;
    canvas.dataset.coverage = reason;
    scene.mix = null; scene.count = 0;
    weather?.interrupt(); weatherTime = null;
    for (const patch of patches) { patch.brightness = null; patch.edgeState = []; patch.materialStates = []; patch.baseState = {}; }
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
      const clock = now();
      if(!next.every(Boolean)) weather?.interrupt();
      // Only advancing, correctly masked frames can contribute weather evidence.
      if (weather && next.every(Boolean) && weather.isDue(clock) &&
          (weatherTime===null || Math.abs(video.currentTime-weatherTime)>.2)) {
        weather.observe(describeWeather(frame, config.weather.samples, config.width, config.height),clock,mix);
        weatherTime=video.currentTime;
      }
      weatherWeights = weather?.weights(clock) ?? {};
      const key=JSON.stringify(weatherWeights);
      if(key!==weatherKey) {
        for(const patch of patches) blendWeatherPixels(patch.weatherSources,weatherWeights,patch.day);
        weatherKey=key;
      }
      output.clearRect(0, 0, canvas.width, canvas.height);
      let visible = 0;
      next.forEach((value, i) => {
        const patch = patches[i];
        if (!value) { patch.brightness = null; patch.edgeState = []; patch.materialStates = []; patch.baseState = {}; return; }
        const region = config.regions[i];
        const samples = weatherSamples(region.samples, patch.weatherSamples, weatherWeights);
        const target = estimateBrightness(frame, {...region,samples}, config, mix);
        if (patch.materials.length) {
          patch.brightness = advanceMaterialGain(patch.baseState, target);
        } else if (target !== null) {
          patch.brightness = patch.brightness === null ? target : patch.brightness + .15 * (target - patch.brightness);
        }
        mixPatches(patch.day, patch.night, mix, patch.brightness ?? 1, patch.pixels.data);
        if (patch.materials.length) {
          const gains = patch.materials.map((material, j) => {
            const samples = weatherSamples(material.samples, patch.weatherMaterials[j], weatherWeights);
            const desired = estimateSampleGain(frame, samples, config, mix, { ...material, minLight: 4 });
            return advanceMaterialGain(patch.materialStates[j] ??= {}, desired);
          });
          applyMaterialGains(patch.pixels.data, patch.day, patch.night, mix, patch.brightness ?? 1, patch.materials, gains);
        }
        if (patch.edge && detailContext) {
          let targets;
          try {
            // Sample the native-sized local wall, not the low-resolution mask probe.
            if (detail.width !== patch.width) detail.width = patch.width;
            if (detail.height !== patch.height) detail.height = patch.height;
            const sx = video.videoWidth / config.width, sy = video.videoHeight / config.height;
            detailContext.drawImage(video, patch.x * sx, patch.y * sy, patch.width * sx, patch.height * sy,
              0, 0, patch.width, patch.height);
            const local = detailContext.getImageData(0, 0, patch.width, patch.height);
            targets = measureEdgeDeltas(local, patch, patch.edge, mix, patch.brightness ?? 1, PHOTO_CORRECTION.saturation);
          } catch {
            // Local adaptation is optional: keep the photographic cover if it fails.
            targets = patch.edge.samples.map(() => null);
          }
          applyEdgeBlend(patch.pixels.data, patch.edge, updateEdgeDeltas(patch.edgeState, targets));
        }
        if (patch.roofTexture && detailContext) {
          try {
            const s = patch.roofTexture.source;
            if (detail.width !== s.width) detail.width = s.width;
            if (detail.height !== s.height) detail.height = s.height;
            const sx = video.videoWidth / config.width, sy = video.videoHeight / config.height;
            detailContext.drawImage(video, s.x * sx, s.y * sy, s.width * sx, s.height * sy,
              0, 0, s.width, s.height);
            applyRoofTexture(patch.pixels.data, patch.roofTexture,
              detailContext.getImageData(0, 0, s.width, s.height), mix);
          } catch { /* The aligned photographic roof remains if the local read fails. */ }
        }
        if (patch.roofGlare) {
          let live = null;
          try {
            const s = patch.roofGlare.source;
            if (detail.width !== s.width) detail.width = s.width;
            if (detail.height !== s.height) detail.height = s.height;
            const sx = video.videoWidth / config.width, sy = video.videoHeight / config.height;
            detailContext.drawImage(video, s.x * sx, s.y * sy, s.width * sx, s.height * sy,
              0, 0, s.width, s.height);
            live = detailContext.getImageData(0, 0, s.width, s.height);
          } catch { /* Still correct opaque photo pixels if the optional live read fails. */ }
          applyRoofGlare(patch.pixels.data, patch.roofGlare, live);
        }
        output.putImageData(patch.pixels, patch.x, patch.y);
        visible++;
      });
      canvas.hidden = visible === 0;
      canvas.dataset.coverage = visible === config.regions.length ? 'photographic' : 'partial-or-unmatched';
      canvas.dataset.profile = mix < .01 ? 'day' : mix > .99 ? 'night' : 'transition';
      canvas.dataset.weatherProfile = weather?.diagnostics().profile ?? 'day';
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
  const profiles = [['day', config.artwork], ['night', config.nightArtwork ?? config.artwork],
    ...(config.weather?.profiles ?? []).filter(p=>p.id!=='day').map(p=>[p.id,p.artwork])];
  function addWeatherProfiles() {
    const candidates=(config.weather?.profiles ?? []).filter(p=>loaded[p.id]);
    const valid=candidates.filter(profile=> {
      const data=loaded[profile.id];
      return data.every((part,i)=>part.data.every((v,p)=>p%4!==3 || v===loaded.day[i].data[p]));
    });
    for(const profile of candidates) if(!valid.includes(profile) && profile.id!=='day') {
      delete loaded[profile.id];
      if(!optionalFailures.includes(profile.id)) optionalFailures.push(profile.id);
    }
    availableProfiles=valid;
    for(let i=0;i<patches.length;i++) {
      const patch=patches[i];
      for(const profile of valid) {
        patch.weatherSources[profile.id]=loaded[profile.id][i].data;
        patch.weatherSamples[profile.id]=profile.regions[i].samples;
        patch.materials.forEach((m,j)=> { (patch.weatherMaterials[j]??={})[profile.id]=profile.regions[i].materials[j]; });
      }
    }
    // Optional downloads settling must not change the displayed photograph by
    // themselves. Start matching once all optional requests have settled.
    const pending=profiles.some(([id])=>!loaded[id] && !optionalFailures.includes(id));
    if(!pending && valid.length) {
      if(weather) weather.updateProfiles(valid);
      else {
        weather=createWeatherSelector(valid,config.weather.samples,config.weather.settings);
        weatherTime=null;weatherKey='';
      }
    }
  }
  function fail(reason) { failed = true; ready = false; stop(reason); }
  for (const [name, url] of profiles) {
    const optional = name!=='day' && name!=='night';
    let settled=false, assetTimer=null, retryTimer=null, attempts=0, accepted=false;
    function clearAssetTimer(id) {timers.clearTimeout(id);assetTimers.delete(id);}
    function settle() {
      if(settled) return false;
      settled=true;clearAssetTimer(assetTimer);return true;
    }
    function reject(reason) {
      if(!optional) {fail(reason);return;}
      delete loaded[name];
      if(!optionalFailures.includes(name)) optionalFailures.push(name);
      if(ready) {availableProfiles=[];addWeatherProfiles();refresh();}
    }
    const image = doc.createElement('img');
    images.push(image);
    image.onload = () => {
      if (destroyed || failed || accepted) return;
      // A slow successful response must still be admitted after the timeout.
      settle(); clearAssetTimer(retryTimer);
      try {
        if (image.naturalWidth !== config.width || image.naturalHeight !== config.height) { reject('asset-mismatch'); return; }
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
        accepted=true;
        const failure=optionalFailures.indexOf(name);
        if(failure!==-1) optionalFailures.splice(failure,1);
        if (!loaded.day || !loaded.night) return;
        if(optional && loaded[name].some((part,i)=>part.data.some((v,p)=>p%4===3 && v!==loaded.day[i].data[p]))) {
          reject('profile-alpha-mismatch');return;
        }
        if(ready) {addWeatherProfiles();refresh();return;}
        patches = loaded.day.map((day, i) => {
          const night = loaded.night[i];
          for (let p = 3; p < day.data.length; p += 4) {
            if (day.data[p] !== night.data[p]) throw new Error('Profile alpha mismatch');
          }
          return { x: day.x, y: day.y, width: day.width, height: day.height,
            day: new Uint8ClampedArray(day.data), night: night.data,
            weatherSources: {}, weatherSamples: {}, weatherMaterials: [],
            edge: prepareEdgeBlend(config.regions[i], day, day.data, night.data), edgeState: [],
            materials: prepareMaterials(config.regions[i], day, day.data), materialStates: [], baseState: {},
            roofTexture: prepareRoofTexture(config.regions[i], day, day.data),
            roofGlare: prepareRoofGlare(config.regions[i], day),
            pixels: output.createImageData(day.width, day.height), brightness: null };
        });
        ready = true; addWeatherProfiles(); refresh();
      } catch { reject('asset-unavailable'); }
    };
    function scheduleRetry() {
      if(!optional || destroyed || accepted || retryTimer!==null) return;
      retryTimer=timers.setTimeout(()=> {
        assetTimers.delete(retryTimer);retryTimer=null;
        if(!destroyed && !accepted) request();
      },attempts<2?30000:300000);
      assetTimers.add(retryTimer);
    }
    image.onerror = () => {
      if(destroyed || accepted) return;
      settle();reject('asset-unavailable');scheduleRetry();
    };
    function request() {
      settled=false;attempts++;
      if(optional) {
        assetTimer=timers.setTimeout(()=> {
          if(!destroyed && !accepted && settle()) {reject('asset-timeout');scheduleRetry();}
        },30000);
        assetTimers.add(assetTimer);
      }
      image.src = attempts===1?url:`${url}${url.includes('?')?'&':'?'}retry=${attempts}`;
    }
    request();
  }
  for (const event of ['loadeddata', 'resize', 'playing']) video.addEventListener(event, refresh);
  doc.addEventListener('visibilitychange', refresh);
  return {
    getDiagnostics() { return {version:'2.24',coverage:canvas.dataset.coverage,dayNightMix:scene.mix,
      weather:weather?.diagnostics()??null,availableProfiles:availableProfiles.map(p=>({id:p.id,label:p.label})),unavailableProfiles:[...optionalFailures]}; },
    setActive(value) {
      const changed = active !== value; active = value;
      if (!value) stop('inactive');
      else if (changed) refresh();
    },
    destroy() {
      destroyed = true; active = false; stop('destroyed');
      for(const id of assetTimers) timers.clearTimeout(id);
      assetTimers.clear();
      for (const image of images) { image.onload = null; image.onerror = null; }
      for (const event of ['loadeddata', 'resize', 'playing']) video.removeEventListener(event, refresh);
      doc.removeEventListener('visibilitychange', refresh);
    },
  };
}
