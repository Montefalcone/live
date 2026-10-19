// Local seam correction. Only a narrow, calibrated strip of masonry is mutable.
// Black-mask coverage and aperture pixels are never altered by this module.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
const luma = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];

function distanceOutside(x, y, polygon) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j], [bx, by] = polygon[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / Math.max(1, dx * dx + dy * dy), 0, 1);
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return inside ? 0 : distance;
}

export function prepareEdgeBlend(region, patch, day, night) {
  const settings = region.edgeBlend;
  if (!settings?.aperture?.length || !settings.samples?.length) return null;
  const offsets = [], strengths = [], influence = [];
  for (let row = 0; row < patch.height; row++) for (let col = 0; col < patch.width; col++) {
    const offset = (row * patch.width + col) * 4;
    if (!day[offset + 3]) continue;
    const x = patch.x + col + .5, y = patch.y + row + .5;
    const depth = Math.max(0, Math.min(x - region.x, region.x + region.width - x, y - region.y, region.y + region.height - y));
    let weight = (1 - smooth(depth / settings.innerWidth)) * smooth(distanceOutside(x, y, settings.aperture) / 3);
    if (settings.maxY !== undefined) weight *= smooth((settings.maxY - y) / 10);
    if (settings.minY !== undefined) weight *= smooth((y - settings.minY) / 10);
    const light = Math.min(luma(day.subarray(offset, offset + 3)), luma(night.subarray(offset, offset + 3)));
    weight *= smooth((light - 55) / 40); // Do not recolor dark rails or shadow details.
    if (weight < .001) continue;
    const distances = settings.samples.map(s => (x - s.x - s.width / 2) ** 2 + (y - s.y - s.height / 2) ** 2);
    const nearest = Math.sqrt(Math.min(...distances));
    weight *= 1 - smooth((nearest - 30) / 50); // No extrapolation far from observed wall.
    if (weight < .001) continue;
    const weights = distances.map(d => 1 / (64 + d));
    const total = weights.reduce((sum, w) => sum + w, 0);
    offsets.push(offset); strengths.push(weight);
    influence.push(...weights.map(w => w / total));
  }
  return { samples: settings.samples, offsets: Uint32Array.from(offsets), strengths: Float32Array.from(strengths), influence: Float32Array.from(influence) };
}

export function measureEdgeDeltas(frame, patch, edge, mix, gain, saturation = .97) {
  return edge.samples.map(sample => {
    const x0 = sample.x - patch.x, y0 = sample.y - patch.y;
    if (x0 < 0 || y0 < 0 || x0 + sample.width > frame.width || y0 + sample.height > frame.height) return null;
    const sum = [0, 0, 0]; let squares = 0, lights = 0, clipped = 0, count = 0;
    for (let y = y0; y < y0 + sample.height; y++) for (let x = x0; x < x0 + sample.width; x++) {
      const p = (y * frame.width + x) * 4, rgb = [frame.data[p], frame.data[p + 1], frame.data[p + 2]];
      const light = luma(rgb); lights += light; squares += light * light; count++;
      if (light < 24 || Math.max(...rgb) > 248) clipped++;
      for (let c = 0; c < 3; c++) sum[c] += rgb[c];
    }
    const mean = sum.map(v => v / count), light = lights / count;
    const sigma = Math.sqrt(Math.max(0, squares / count - light * light));
    const expectedSigma = sample.referenceSigma * (1 - mix) + sample.nightReferenceSigma * mix;
    if (clipped / count > .02 || sigma > Math.max(12, expectedSigma * 2 + 4)) return null;
    const reference = sample.reference.map((v, c) => v * (1 - mix) + sample.nightReference[c] * mix);
    const gray = luma(reference);
    const delta = mean.map((v, c) => v - (gray + (reference[c] - gray) * saturation) * gain);
    // Reject a new occluder/strongly incompatible light; keep small corrections bounded.
    if (Math.max(...delta.map(Math.abs)) > 65) return null;
    const brightness = luma(delta);
    if (Math.abs(brightness) > 45) return null;
    return delta.map(v => clamp(brightness, -28, 28) + clamp(v - brightness, -16, 16));
  });
}

export function updateEdgeDeltas(state, targets) {
  return targets.map((target, i) => {
    const item = state[i] ??= { value: null, candidate: null, count: 0, misses: 0 };
    if (!target) {
      item.count = 0;
      if (++item.misses > 4 && item.value) item.value = item.value.map(v => v * .85);
      return item.value ?? [0, 0, 0];
    }
    item.misses = 0;
    if (!item.value) { item.value = target; return target; }
    if (Math.max(...target.map((v, c) => Math.abs(v - item.value[c]))) > 8) {
      if (!item.candidate || Math.max(...target.map((v, c) => Math.abs(v - item.candidate[c]))) > 6) item.count = 0;
      item.candidate = target;
      if (++item.count < 3) return item.value;
    } else item.count = 0;
    item.value = item.value.map((v, c) => v + .15 * (target[c] - v));
    return item.value;
  });
}

export function applyEdgeBlend(pixels, edge, deltas) {
  const count = edge.samples.length;
  for (let i = 0; i < edge.offsets.length; i++) {
    const p = edge.offsets[i], strength = edge.strengths[i];
    for (let c = 0; c < 3; c++) {
      let correction = 0;
      for (let j = 0; j < count; j++) correction += (deltas[j]?.[c] ?? 0) * edge.influence[i * count + j];
      pixels[p + c] += correction * strength;
    }
    // Never touch alpha, and never alter pixels excluded by prepareEdgeBlend.
  }
  return pixels;
}
