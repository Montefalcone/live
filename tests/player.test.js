import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LivePlayer } from '../js/player.js';

class Clock {
  time = 0; next = 1; jobs = new Map();
  now = () => this.time;
  setTimeout = (fn, ms) => this.add(fn, ms, false);
  setInterval = (fn, ms) => this.add(fn, ms, true);
  clearTimeout = id => this.jobs.delete(id);
  clearInterval = id => this.jobs.delete(id);
  add(fn, ms, repeat) { const id = this.next++; this.jobs.set(id, { fn, at: this.time + ms, ms, repeat }); return id; }
  tick(ms) {
    const end = this.time + ms;
    for (;;) {
      const job = [...this.jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!job) break;
      const [id, j] = job;
      this.time = j.at;
      if (j.repeat) j.at += j.ms; else this.jobs.delete(id);
      j.fn();
    }
    this.time = end;
  }
}
class Video extends EventTarget {
  currentTime = 0; paused = true; ended = false; readyState = 3; src = ''; native = false;
  playImpl = null;
  canPlayType() { return this.native ? 'probably' : ''; }
  play() { this.paused = false; return this.playImpl?.() ?? Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.currentTime = 0; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  progress(time) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')); }
}
function setup({ native = false, supported = true } = {}) {
  const instances = [];
  class Hls {
    static Events = { MEDIA_ATTACHED: 'attached', MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' };
    static isSupported = () => supported;
    callbacks = new Map(); destroyed = false; recoveries = 0;
    constructor() { instances.push(this); }
    on(name, fn) { this.callbacks.set(name, fn); }
    emit(name, data) { this.callbacks.get(name)?.(name, data); }
    attachMedia() { this.emit('attached'); }
    loadSource(url) { this.url = url; }
    destroy() { this.destroyed = true; }
    recoverMediaError() { this.recoveries++; }
  }
  const video = new Video(); video.native = native;
  const clock = new Clock(); const states = [];
  const player = new LivePlayer({ video, Hls, url: 'https://test.invalid/piazza/index.m3u8', clock, onState: (state, details) => states.push({ state, details }) });
  return { player, video, clock, states, instances };
}
function play(s) { s.player.start(); s.instances.at(-1)?.emit('manifest'); s.video.progress(1); }

test('one HLS instance, live status only after advancing video, pause releases traffic', () => {
  const s = setup(); s.player.start();
  assert.equal(s.player.state, 'loading');
  s.instances[0].emit('manifest');
  assert.equal(s.player.state, 'loading');
  s.video.progress(1); assert.equal(s.player.state, 'playing');
  s.player.pause(); assert.equal(s.player.state, 'paused');
  assert.equal(s.instances[0].destroyed, true);
  s.clock.tick(120000); assert.equal(s.instances.length, 1);
  assert.equal(s.clock.jobs.size, 0);
});
test('hidden tab destroys the pipeline; return resumes only if user wanted playback', () => {
  const s = setup(); play(s);
  s.player.setHidden(true); assert.equal(s.player.state, 'suspended');
  assert.equal(s.instances[0].destroyed, true);
  s.clock.tick(90000); assert.equal(s.instances.length, 1);
  s.player.setHidden(false); assert.equal(s.instances.length, 2);
  s.player.pause(); s.player.setHidden(true); s.player.setHidden(false);
  assert.equal(s.instances.length, 2); assert.equal(s.player.state, 'paused');
});
test('late errors and manifest callbacks from old instances cannot restart playback', () => {
  const s = setup(); play(s); const old = s.instances[0];
  s.player.reconnect(); const current = s.instances[1];
  old.emit('error', { fatal: true, type: 'network' }); old.emit('manifest');
  assert.equal(current.destroyed, false); assert.equal(s.player.state, 'loading');
  assert.equal(s.player.retryTimer, null);
});
test('fatal errors back off and manual reconnect cancels the previous retry', () => {
  const s = setup(); s.player.start();
  s.instances[0].emit('error', { fatal: true, type: 'network' });
  assert.equal(s.states.at(-1).details.retryIn, 2);
  s.clock.tick(2000); assert.equal(s.instances.length, 2);
  s.instances[1].emit('manifest');
  s.instances[1].emit('error', { fatal: true, type: 'network' });
  assert.equal(s.states.at(-1).details.retryIn, 5);
  s.player.reconnect(); assert.equal(s.instances.length, 3);
  s.clock.tick(5000); assert.equal(s.instances.length, 3);
});
test('frozen playback triggers recovery; a healthy video does not', () => {
  const s = setup(); play(s);
  for (let second = 2; second <= 20; second++) { s.video.progress(second); s.clock.tick(1000); }
  assert.equal(s.instances.length, 1); assert.equal(s.player.state, 'playing');
  s.clock.tick(12000); assert.equal(s.player.state, 'offline');
  assert.equal(s.instances[0].destroyed, true);
  s.clock.tick(2000); assert.equal(s.instances.length, 2);
});
test('native HLS startup stalls recover after the startup deadline', () => {
  const s = setup({ native: true }); s.player.start();
  assert.equal(s.instances.length, 0); assert.match(s.video.src, /index.m3u8/);
  s.clock.tick(20000); assert.equal(s.player.state, 'offline'); assert.equal(s.video.src, '');
  s.clock.tick(2000); assert.equal(s.player.state, 'loading'); assert.match(s.video.src, /index.m3u8/);
});
test('autoplay rejection becomes a user action, without downloading in the background', async () => {
  const s = setup({ native: true });
  s.video.playImpl = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  s.player.start(); await Promise.resolve();
  assert.equal(s.player.state, 'gesture'); assert.equal(s.player.wanted, false);
  assert.equal(s.video.src, ''); assert.equal(s.clock.jobs.size, 0);
  s.video.playImpl = null; s.player.start(); s.video.progress(1);
  assert.equal(s.player.state, 'playing');
});
test('network offline stops retries and reconnection resumes without overriding a pause', () => {
  const s = setup(); play(s); s.player.setOnline(false);
  assert.equal(s.player.state, 'offline'); assert.equal(s.clock.jobs.size, 0);
  s.clock.tick(120000); assert.equal(s.instances.length, 1);
  s.player.setOnline(true); assert.equal(s.instances.length, 2);
  s.player.pause(); s.player.setOnline(false); s.player.setOnline(true);
  assert.equal(s.instances.length, 2);
});
test('native fullscreen pause is treated as a user pause', () => {
  const s = setup({ native: true }); play(s); s.video.pause();
  assert.equal(s.player.wanted, false); assert.equal(s.player.state, 'paused');
  assert.equal(s.video.src, '');
});
test('unsupported browser produces a stable state, without retry loops', () => {
  const s = setup({ supported: false }); s.player.start();
  assert.equal(s.player.state, 'unsupported'); assert.equal(s.clock.jobs.size, 0);
});
test('media error gets one local recovery, then a fresh pipeline', () => {
  const s = setup(); play(s);
  s.instances[0].emit('error', { fatal: true, type: 'media' });
  assert.equal(s.instances[0].recoveries, 1);
  s.instances[0].emit('error', { fatal: true, type: 'media' });
  assert.equal(s.player.state, 'offline'); assert.equal(s.instances[0].destroyed, true);
});
test('destroy cancels every future retry and stale callback', () => {
  const s = setup(); play(s); const old = s.instances[0];
  old.emit('error', { fatal: true, type: 'network' }); s.player.destroy();
  s.clock.tick(120000); old.emit('manifest'); s.player.start();
  assert.equal(s.instances.length, 1); assert.equal(s.clock.jobs.size, 0);
});
