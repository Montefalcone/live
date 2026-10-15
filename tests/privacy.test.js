import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_CORRECTION, tintPatch, mixPatches, advanceScene, estimateNightMix, estimateBrightness, analyzeFrame, createPrivacyLayer } from '../js/privacy.js';

test('brightness adaptation preserves warm RGB proportions and alpha, including highlights', () => {
  const source = new Uint8ClampedArray([120, 80, 40, 255, 240, 160, 80, 128]);
  const bright = mixPatches(source, source, .5, 1.5);
  assert.deepEqual([...bright], [180, 120, 60, 255, 255, 170, 85, 128]);
  const dark = mixPatches(source, source, .5, .75);
  assert.deepEqual([...dark], [90, 60, 30, 255, 180, 120, 60, 128]);
  assert.equal(source[0], 120, 'the reference is immutable');
});

test('wall light controls one bounded brightness factor, independent of its color', () => {
  const region = { samples: [{ x: 2, y: 2, width: 8, height: 8, reference: [100, 100, 100] }] };
  assert.equal(estimateBrightness(frame(true, [150, 150, 150]), region, config), 1.1);
  assert.equal(estimateBrightness(frame(true, [200, 200, 200]), region, config), 1.1);
  assert.equal(estimateBrightness(frame(true, [30, 30, 30]), region, config), .9);
  const gain = estimateBrightness(frame(true, [180, 120, 60]), region, config);
  assert.equal(gain, 1.1);
  const calibrated = { samples: [{ ...region.samples[0], nightReference: [150, 150, 150] }] };
  assert.equal(estimateBrightness(frame(true, [150, 150, 150]), calibrated, config, 1), 1);
});

test('unreliable wall readings do not request a new brightness correction', () => {
  const sample = { x: 2, y: 2, width: 8, height: 8, reference: [100, 100, 100] };
  for (const background of [[0, 0, 0], [255, 255, 255]]) {
    assert.equal(estimateBrightness(frame(true, background), { samples: [sample] }, config), null);
  }
  assert.equal(estimateBrightness(frame(), { samples: [sample, { ...sample, reference: [50, 50, 50] }] }, config), null);
});

test('photographic cover keeps its warm color and opacity with only a subtle fixed desaturation', () => {
  const source = new Uint8ClampedArray([120, 100, 80, 255, 80, 70, 60, 128, 0, 0, 0, 0]);
  const result = tintPatch(source, PHOTO_CORRECTION);
  assert.ok(result[0] > result[1] && result[1] > result[2], 'wood must stay warm, not gray');
  for (let i = 0; i < source.length; i++) {
    if (i % 4 === 3) assert.equal(result[i], source[i], 'alpha must never change');
    else assert.ok(Math.abs(result[i] - source[i]) <= 1, 'correction must remain subtle');
  }
  assert.equal(source[0], 120);
});
test('gray, dark and brightly lit surroundings never trigger RGB shifts or monochrome covers', () => {
  const original = new Uint8ClampedArray([180, 115, 45, 255]);
  const expected = tintPatch(original, PHOTO_CORRECTION);
  for (const background of [[100, 100, 100], [0, 0, 0], [255, 255, 255], [190, 120, 20]]) {
    const correction = analyzeFrame(frame(true, background), config)[0];
    assert.deepEqual(tintPatch(original, correction), expected);
    assert.equal(correction.saturation, .97);
    assert.deepEqual(correction.gain, [1, 1, 1]);
  }
});
test('repeated updates do not progressively desaturate the reference image', () => {
  const original = new Uint8ClampedArray([160, 110, 50, 255]);
  const expected = tintPatch(original, PHOTO_CORRECTION);
  for (let i = 0; i < 100; i++) assert.deepEqual(tintPatch(original, PHOTO_CORRECTION), expected);
  assert.deepEqual([...original], [160, 110, 50, 255]);
});

const config = {
  width: 64, height: 36, artwork: './test.png', nightArtwork: './night.png',
  regions: [{ x: 24, y: 12, width: 20, height: 24 }],
};
function frame(masked = true, background = [100, 100, 100]) {
  const data = new Uint8ClampedArray(512 * 288 * 4);
  for (let y = 0; y < 288; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4;
    const black = masked && x >= 24 * 8 && x < 44 * 8 && y >= 12 * 8;
    data.set([...(black ? [0, 0, 0] : background), 255], i);
  }
  return { data, width: 512, height: 288 };
}
test('missing or moved black masks reject the cosmetic patch', () => {
  assert.ok(analyzeFrame(frame(), config)[0]);
  assert.equal(analyzeFrame(frame(false), config)[0], null);
});

function setup() {
  const doc = new EventTarget(); doc.hidden = false;
  const video = new EventTarget(); Object.assign(video, { videoWidth: 64, videoHeight: 36, readyState: 2 });
  const state = { denied: false, writes: 0, images: [], contexts: 0, wrongAlpha: false };
  const context = {
    drawImage(image) { if (state.denied) throw new Error('SecurityError'); state.source = image.src; },
    getImageData(x, y, width, height) {
      if (width === 512) return frame();
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      if (state.wrongAlpha && state.source === './night.png') data[3] = 254;
      return { data, width, height };
    },
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    clearRect() {}, putImageData() { state.writes++; },
  };
  const canvas = { hidden: false, dataset: {}, getContext: () => context };
  doc.createElement = type => {
    if (type === 'img') { const image = { naturalWidth: 64, naturalHeight: 36 }; state.images.push(image); return image; }
    return { getContext: () => context };
  };
  const pending = new Map(); let index = 0;
  const timers = { setTimeout(fn) { pending.set(++index, fn); return index; }, clearTimeout(id) { pending.delete(id); } };
  const controller = createPrivacyLayer({ video, canvas, config, document: doc, timers });
  return { doc, video, canvas, state, pending, controller };
}
const loadAssets = s => s.state.images.forEach(image => image.onload());
test('layer waits for both assets, stops on pause, and resumes without duplicate timers', () => {
  const s = setup();
  s.controller.setActive(true); assert.equal(s.canvas.hidden, true);
  s.state.images[0].onload(); assert.equal(s.canvas.hidden, true);
  s.state.images[1].onload(); assert.equal(s.canvas.hidden, false); assert.equal(s.pending.size, 1);
  s.controller.setActive(true); assert.equal(s.pending.size, 1);
  s.controller.setActive(false); assert.equal(s.canvas.hidden, true); assert.equal(s.pending.size, 0);
  s.controller.setActive(true); assert.equal(s.canvas.hidden, false);
  s.controller.destroy(); assert.equal(s.canvas.hidden, true); assert.equal(s.pending.size, 0);
  s.video.dispatchEvent(new Event('playing')); assert.equal(s.pending.size, 0);
});
test('CORS failure, image failure and incompatible framing fall back to the masked video', () => {
  for (const reason of ['cors', 'format', 'image']) {
    const s = setup();
    s.controller.setActive(true);
    if (reason === 'cors') s.state.denied = true;
    if (reason === 'format') s.video.videoWidth = 48;
    if (reason === 'image') s.state.images[1].onerror();
    loadAssets(s);
    assert.equal(s.canvas.hidden, true, reason);
    assert.equal(s.pending.size, 0, reason);
    assert.equal(s.state.writes, 0, reason);
  }
});
test('hidden tabs suspend sampling and visible tabs restart it', () => {
  const s = setup(); loadAssets(s); s.controller.setActive(true);
  s.doc.hidden = true; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.canvas.hidden, true); assert.equal(s.pending.size, 0);
  s.doc.hidden = false; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.canvas.hidden, false); assert.equal(s.pending.size, 1);
  s.controller.destroy();
});


test('a mismatched profile alpha map never exposes a partially covered core', () => {
  const s = setup(); s.state.wrongAlpha = true;
  s.controller.setActive(true); loadAssets(s);
  assert.equal(s.canvas.hidden, true);
  assert.equal(s.state.writes, 0);
  assert.equal(s.pending.size, 0);
});
test('day/night interpolation keeps opaque and feathered coverage constant', () => {
  const day = new Uint8ClampedArray([180, 110, 60, 255, 120, 90, 40, 80]);
  const night = new Uint8ClampedArray([160, 145, 130, 255, 160, 150, 130, 80]);
  for (const mix of [0, .25, .5, .75, 1]) {
    const result = mixPatches(day, night, mix, 1);
    assert.equal(result[3], 255); assert.equal(result[7], 80);
    assert.equal(result[0], Math.round(180 * (1 - mix) + 160 * mix));
  }
  assert.deepEqual(mixPatches(day, night, 0, 1), day);
  assert.deepEqual(mixPatches(day, night, 1, 1), night);
});
test('night startup is immediate, brief flashes are ignored, sustained changes are gradual', () => {
  const state = { mix: null, count: 0 };
  assert.equal(advanceScene(state, 1), 1);
  for (let i = 0; i < 5; i++) assert.equal(advanceScene(state, 0), 1);
  assert.equal(advanceScene(state, 1), 1);
  for (let i = 0; i < 5; i++) assert.equal(advanceScene(state, 0), 1);
  assert.equal(advanceScene(state, null), 1);
  for (let i = 0; i < 5; i++) assert.equal(advanceScene(state, 0), 1);
  assert.equal(advanceScene(state, 0), .85);
  for (let i = 0; i < 40; i++) advanceScene(state, 0);
  assert.equal(state.mix, 0);
});
test('sky/facade contrast selects day, twilight and night independently of exposure', () => {
  const sky = { x: 2, y: 2, width: 8, height: 4, reference: [200, 200, 200], nightReference: [0, 0, 0] };
  const wall = { x: 2, y: 14, width: 8, height: 8, reference: [100, 100, 100], nightReference: [180, 180, 180] };
  const calibrated = { ...config, skySamples: [sky], regions: [{ ...config.regions[0], samples: [wall] }] };
  function scene(skyLight, wallLight) {
    const f = frame(true, [wallLight, wallLight, wallLight]);
    for (let y = 16; y < 48; y++) for (let x = 16; x < 80; x++) f.data.set([skyLight, skyLight, skyLight, 255], (y * f.width + x) * 4);
    return estimateNightMix(f, calibrated);
  }
  assert.equal(scene(200, 100), 0);
  assert.equal(scene(100, 50), 0, 'a darker daytime exposure must remain day');
  assert.equal(scene(0, 180), 1);
  assert.ok(Math.abs(scene(68, 100) - .5) < 1e-6);
  assert.equal(scene(0, 0), null, 'an unreadable facade cannot select a profile');
});
