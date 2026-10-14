import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_CORRECTION, tintPatch, analyzeFrame, createPrivacyLayer } from '../js/privacy.js';

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
  width: 64, height: 36, artwork: './test.png',
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
  const state = { denied: false, writes: 0, image: null, contexts: 0 };
  const context = {
    drawImage() { if (state.denied) throw new Error('SecurityError'); },
    getImageData(x, y, width, height) {
      return width === 512 ? frame() : { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height };
    },
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    clearRect() {}, putImageData() { state.writes++; },
  };
  const canvas = { hidden: false, dataset: {}, getContext: () => context };
  doc.createElement = type => {
    if (type === 'img') { state.image = { naturalWidth: 64, naturalHeight: 36 }; return state.image; }
    return { getContext: () => context };
  };
  const pending = new Map(); let index = 0;
  const timers = { setTimeout(fn) { pending.set(++index, fn); return index; }, clearTimeout(id) { pending.delete(id); } };
  const controller = createPrivacyLayer({ video, canvas, config, document: doc, timers });
  return { doc, video, canvas, state, pending, controller };
}
test('layer waits for its asset, stops on pause, and resumes without duplicate timers', () => {
  const s = setup();
  s.controller.setActive(true); assert.equal(s.canvas.hidden, true);
  s.state.image.onload(); assert.equal(s.canvas.hidden, false); assert.equal(s.pending.size, 1);
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
    if (reason === 'image') s.state.image.onerror(); else s.state.image.onload();
    assert.equal(s.canvas.hidden, true, reason);
    assert.equal(s.pending.size, 0, reason);
    assert.equal(s.state.writes, 0, reason);
  }
});
test('hidden tabs suspend sampling and visible tabs restart it', () => {
  const s = setup(); s.state.image.onload(); s.controller.setActive(true);
  s.doc.hidden = true; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.canvas.hidden, true); assert.equal(s.pending.size, 0);
  s.doc.hidden = false; s.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(s.canvas.hidden, false); assert.equal(s.pending.size, 1);
  s.controller.destroy();
});
