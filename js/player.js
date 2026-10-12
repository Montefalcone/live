const realClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: id => clearInterval(id),
};

const BUFFERING_DELAY_MS = 2000;

/** Owns one playback session. Every async callback is tied to its generation. */
export class LivePlayer {
  constructor({ video, url, Hls, onState = () => {}, clock = realClock }) {
    this.video = video;
    this.url = url;
    this.Hls = Hls;
    this.onState = onState;
    this.clock = clock;
    this.state = 'idle';
    this.wanted = false;
    this.hidden = false;
    this.online = true;
    this.disposed = false;
    this.generation = 0;
    this.attempts = 0;
    this.hls = null;
    this.retryTimer = null;
    this.watchTimer = null;
    this.cleanups = [];
  }

  start() {
    if (this.disposed) return;
    this.wanted = true;
    this.attempts = 0;
    this._open();
  }

  pause() {
    if (this.disposed) return;
    this.wanted = false;
    this._teardown();
    this._state('paused');
  }

  reconnect() { this.start(); }

  setHidden(hidden) {
    if (this.disposed || this.hidden === hidden) return;
    this.hidden = hidden;
    if (!this.wanted) return;
    if (hidden) {
      this._teardown();
      this._state('suspended');
    } else {
      this._open();
    }
  }

  setOnline(online) {
    if (this.disposed || this.online === online) return;
    this.online = online;
    if (!this.wanted) return;
    if (!online) {
      this._teardown();
      this._state('offline', { reason: 'network' });
    } else if (!this.hidden) {
      this.attempts = 0;
      this._open();
    }
  }

  destroy() {
    this.wanted = false;
    this.disposed = true;
    this._teardown();
  }

  _state(state, details = {}) {
    const changed = this.state !== state;
    this.state = state;
    if (changed || Object.keys(details).length) this.onState(state, details);
  }

  _teardown() {
    this.generation++;
    this.clock.clearTimeout(this.retryTimer);
    this.clock.clearInterval(this.watchTimer);
    this.retryTimer = this.watchTimer = null;
    for (const remove of this.cleanups) remove();
    this.cleanups = [];
    if (this.hls) {
      const old = this.hls;
      this.hls = null;
      old.destroy();
    }
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }

  _listen(event, handler) {
    this.video.addEventListener(event, handler);
    this.cleanups.push(() => this.video.removeEventListener(event, handler));
  }

  _open() {
    this._teardown();
    if (!this.wanted || this.disposed) return;
    if (this.hidden) { this._state('suspended'); return; }
    if (!this.online) { this._state('offline', { reason: 'network' }); return; }
    const token = this.generation;
    const active = () => token === this.generation && this.wanted && !this.disposed;
    this._state('loading');
    const started = this.clock.now();
    let lastProgress = started;
    let lastTime = this.video.currentTime;
    let hasProgress = false;
    let stableSince = null;
    let mediaRecoveries = 0;
    const progress = () => {
      if (!active() || this.video.paused || this.video.readyState < 2) return;
      if (Math.abs(this.video.currentTime - lastTime) < 0.04) return;
      lastTime = this.video.currentTime;
      lastProgress = this.clock.now();
      hasProgress = true;
      if (stableSince === null) stableSince = lastProgress;
      // A successful play() promise alone must not reset repeated failures.
      if (lastProgress - stableSince >= 15000) this.attempts = 0;
      this._state('playing');
    };
    const buffer = () => {
      if (!active()) return;
      // Network events can fire between HLS segments while playback continues.
      // Only cover the picture after a sustained lack of video progress.
      progress();
      if (!hasProgress || this.clock.now() - lastProgress < BUFFERING_DELAY_MS) return;
      stableSince = null;
      this._state('buffering');
    };
    const fail = () => { if (active()) this._fail(); };
    const play = () => {
      if (!active()) return;
      let result;
      try { result = this.video.play(); } catch (error) { rejected(error); return; }
      if (result?.catch) result.catch(rejected);
    };
    const rejected = error => {
      if (!active() || error?.name === 'AbortError') return;
      if (error?.name === 'NotAllowedError') {
        this.wanted = false;
        this._teardown();
        this._state('gesture');
      } else {
        fail();
      }
    };
    this._listen('timeupdate', progress);
    this._listen('waiting', buffer);
    this._listen('stalled', buffer);
    this._listen('ended', fail);
    this._listen('error', fail);
    // Native video controls (e.g. iOS fullscreen) must respect a user's pause too.
    this._listen('pause', () => { if (active() && hasProgress && !this.video.ended) this.pause(); });
    this.watchTimer = this.clock.setInterval(() => {
      if (!active()) return;
      progress();
      const elapsed = this.clock.now() - lastProgress;
      if (!hasProgress && this.clock.now() - started >= 20000) { fail(); return; }
      if (hasProgress && elapsed >= 12000) { fail(); return; }
      if (hasProgress && elapsed >= BUFFERING_DELAY_MS) buffer();
    }, 1000);

    try {
      if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
        this.video.src = this.url;
        this.video.load();
        play();
      } else if (this.Hls?.isSupported()) {
        const Hls = this.Hls;
        const instance = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 4,
          maxBufferLength: 12,
          maxMaxBufferLength: 24,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 6,
          maxLiveSyncPlaybackRate: 1.05,
          capLevelToPlayerSize: true,
        });
        this.hls = instance;
        instance.on(Hls.Events.MEDIA_ATTACHED, () => { if (active()) instance.loadSource(this.url); });
        instance.on(Hls.Events.MANIFEST_PARSED, play);
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (!active() || !data?.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
            mediaRecoveries++;
            buffer();
            try { instance.recoverMediaError(); } catch { fail(); }
          } else fail();
        });
        instance.attachMedia(this.video);
      } else {
        this.wanted = false;
        this._teardown();
        this._state('unsupported');
      }
    } catch { fail(); }
  }

  _fail() {
    this._teardown();
    if (!this.wanted || this.disposed) return;
    this.attempts++;
    const delay = [2000, 5000, 10000, 20000, 30000][Math.min(this.attempts - 1, 4)];
    this._state('offline', { retryIn: delay / 1000 });
    const token = this.generation;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (token === this.generation && this.wanted && !this.hidden && this.online && !this.disposed) this._open();
    }, delay);
  }
}
