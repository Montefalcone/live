// Separate exposure for the small roof spill. Never change RGB balance or alpha.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const light = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const median = a => { const b = [...a].sort((x,y)=>x-y), n = b.length; return n % 2 ? b[n>>1] : (b[n/2-1]+b[n/2])/2; };
const smooth = x => { const t = clamp(x,0,1); return t*t*(3-2*t); };

export function estimateSampleGain(frame, samples, config, mix, settings = {}) {
  const ratios = [];
  const floor = settings.minLight ?? 20;
  for (const sample of samples ?? []) {
    const x0 = Math.max(0, Math.ceil(sample.x * frame.width / config.width));
    const x1 = Math.min(frame.width, Math.floor((sample.x + sample.width) * frame.width / config.width));
    const y0 = Math.max(0, Math.ceil(sample.y * frame.height / config.height));
    const y1 = Math.min(frame.height, Math.floor((sample.y + sample.height) * frame.height / config.height));
    const sum = [0,0,0]; let count = 0;
    for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) {
      const p=(y*frame.width+x)*4;
      for(let c=0;c<3;c++) sum[c]+=frame.data[p+c];
      count++;
    }
    if (!count) continue;
    const actual = light(sum.map(v=>v/count));
    const expected = light(sample.reference.map((v,c)=>v*(1-mix)+(sample.nightReference ?? sample.reference)[c]*mix));
    if (actual < floor || actual > 240 || expected < floor) continue;
    ratios.push(actual/expected);
  }
  if (ratios.length < 2) return null;
  const center = median(ratios);
  // A passing shadow or reflection must not drive the whole facade/roof.
  const consistent = ratios.filter(r=>Math.abs(r/center-1)<.25);
  if (consistent.length < Math.max(2, Math.ceil(ratios.length/2))) return null;
  const range = settings.gainRange ?? [.85,1.18];
  return clamp(median(consistent),range[0],range[1]);
}

export function prepareMaterials(region, patch, alphaSource) {
  return (region.materials ?? []).map(material => {
    const offsets=[], weights=[];
    for(let y=0;y<patch.height;y++) for(let x=0;x<patch.width;x++) {
      const p=(y*patch.width+x)*4;
      if (!alphaSource[p+3]) continue;
      const gx=patch.x+x+.5,gy=patch.y+y+.5;
      let weight=0;
      for(const line of material.lines) {
        if(gx<line.x0 || gx>line.x1) continue;
        const edgeY=line.y0+(line.y1-line.y0)*(gx-line.x0)/(line.x1-line.x0);
        weight=Math.max(weight,1-smooth((gy-edgeY)/(material.transition ?? 4)));
      }
      if(weight>.001){offsets.push(p);weights.push(weight);}
    }
    return { ...material, offsets:Uint32Array.from(offsets), weights:Float32Array.from(weights) };
  });
}

export function advanceMaterialGain(state, target) {
  if(target===null || !Number.isFinite(target)) {
    state.misses=(state.misses??0)+1;state.count=0;
    if(state.gain===null || state.gain===undefined) return state.gain=1;
    if(state.misses>4) state.gain+=.15*(1-state.gain);
    return state.gain;
  }
  state.misses=0;
  if(state.gain===null || state.gain===undefined) { state.gain=target; return target; }
  if(Math.abs(target-state.gain)>.12) {
    if(state.candidate===undefined || Math.abs(target-state.candidate)>.08) state.count=0;
    state.candidate=target;state.count=(state.count??0)+1;
    if(state.count<3) return state.gain;
  } else state.count=0;
  state.gain+=.15*(target-state.gain);
  return state.gain;
}

export function applyMaterialGains(destination, day, night, mix, baseGain, materials, gains) {
  // Recompute from immutable originals: no repeated multiplication or color drift.
  for(let m=0;m<materials.length;m++) {
    const material=materials[m], gain=gains[m]??1;
    for(let i=0;i<material.offsets.length;i++) {
      const p=material.offsets[i],w=material.weights[i];
      const r=day[p]*(1-mix)+night[p]*mix;
      const g=day[p+1]*(1-mix)+night[p+1]*mix;
      const b=day[p+2]*(1-mix)+night[p+2]*mix;
      const safe=Math.min(baseGain*(1-w)+gain*w,255/Math.max(1,r,g,b));
      destination[p]=r*safe;destination[p+1]=g*safe;destination[p+2]=b*safe;
    }
  }
  return destination;
}

// Only the tiny roof spill borrows nearby, already-public live tiles. Facades,
// apertures and the gutter keep the photographic reference. No unmasked feed.
export function prepareRoofTexture(region, patch, alpha) {
  const spec = region.roofTexture;
  if (!spec) return null;
  const { x, y, width, height, dx, dy } = spec;
  const lines = spec.lines ?? [spec.line];
  const offsets = [], sources = [], weights = [];
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const gx = x + col, gy = y + row, px = gx - patch.x, py = gy - patch.y;
    if (px < 0 || py < 0 || px >= patch.width || py >= patch.height) continue;
    const p = (py * patch.width + px) * 4;
    if (!alpha[p + 3]) continue;
    const line = lines.find(edge => edge && gx >= edge.x0 && gx <= edge.x1);
    if (!line) continue;
    const edge = line.y0 + (line.y1 - line.y0) * (gx - line.x0) / (line.x1 - line.x0);
    const w = smooth((edge - gy - spec.inset) / spec.transition);
    if (w > .001) { offsets.push(p); sources.push((row * width + col) * 4); weights.push(w); }
  }
  return { source: { x: x + dx, y: y + dy, width, height },
    offsets: Uint32Array.from(offsets), sources: Uint32Array.from(sources), weights: Float32Array.from(weights) };
}

export function applyRoofTexture(destination, texture, frame, mix) {
  const { width, height } = texture.source;
  if (frame.width !== width || frame.height !== height || frame.data.length !== width * height * 4) return false;
  // Darkness is normal at night; a black source in daylight is unreliable.
  let black = 0;
  for (let p = 0; p < frame.data.length; p += 4) if (Math.max(frame.data[p], frame.data[p+1], frame.data[p+2]) < 12) black++;
  if (mix < .5 && black / (width * height) > .95) return false;
  for (let i = 0; i < texture.offsets.length; i++) {
    const p = texture.offsets[i], q = texture.sources[i], w = texture.weights[i];
    for (let c = 0; c < 3; c++) destination[p+c] = destination[p+c] * (1-w) + frame.data[q+c] * w;
  }
  return true;
}
