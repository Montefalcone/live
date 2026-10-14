import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCorrection, smoothCorrection, tintPatch, analyzeFrame, createPrivacyLayer } from '../js/privacy.js';

test('light correction follows the facade while preserving full opacity and source pixels', () => {
  const correction = estimateCorrection([[60, 50, 40], [60, 50, 40]], [[120, 100, 80], [120, 100, 80]]);
  assert.deepEqual(correction.gain, [.5, .5, .5]);
  const source = new Uint8ClampedArray([120, 100, 80, 255, 80, 70, 60, 128, 0, 0, 0, 0]);
  const result = tintPatch(source, correction);
  assert.deepEqual([...result], [60, 50, 40, 255, 40, 35, 30, 128, 0, 0, 0, 0]);
  assert.equal(source[0], 120, 'reference must not accumulate corrections');
});
test('black samples, invalid numbers and extreme exposure cannot produce a bright misplaced patch', () => {
  for (const sample of [[0, 0, 0], [NaN, 60, 40], [255, 255, 255]]) {
    assert.equal(estimateCorrection([sample], [[40, 40, 40]]), null);
  }
});
test('monochrome surroundings remove color and transitions are gradual', () => {
  const next = estimateCorrection([[40, 40, 40]], [[100, 90, 60]]);
  assert.equal(next.saturation, 0);
  const result = tintPatch(new Uint8ClampedArray([120, 90, 30, 255]), next);
  assert.equal(result[0], result[1]); assert.equal(result[1], result[2]);
  const mixed = smoothCorrection({ gain: [1, 1, 1], saturation: 1 }, next);
  assert.ok(mixed.gain[0] > next.gain[0] && mixed.gain[0] < 1);
  assert.equal(mixed.saturation, .75);
});

const config = {
  width: 64, height: 36, artwork: './test.png',
  regions: [{ x: 24, y: 12, width: 20, height: 24, samples: [{ x: 0, y: 0, width: 8, height: 8, reference: [100, 100, 100] }] }],
};
function frame(masked = true) {
  const data = new Uint8ClampedArray(512 * 288 * 4);
  for (let y = 0; y < 288; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4;
    const black = masked && x >= 24 * 8 && x < 44 * 8 && y >= 12 * 8;
    data.set([black ? 0 : 100, black ? 0 : 100, black ? 0 : 100, 255], i);
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
