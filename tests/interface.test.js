import { playbackPresentation } from '../js/interface.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandscapeController, enhanceDisclosure, typeTitle, limitPlayerZoom, preventPictureInPicture } from '../js/interface.js';

function orientationSetup(overrides = {}) {
  const state = { full: true, mobile: true, locks: 0, unlocks: 0 };
  const controller = createLandscapeController({
    orientation: {
      lock: async value => { assert.equal(value, 'landscape'); state.locks++; },
      unlock: () => state.unlocks++,
      ...overrides,
    },
    isFullscreen: () => state.full,
    isMobile: () => state.mobile,
  });
  return { state, controller };
}
test('orientation is requested only for a mobile fullscreen session, then released', async () => {
  const { state, controller } = orientationSetup();
  state.mobile = false;
  assert.equal(await controller.enter(), false);
  state.mobile = true;
  state.full = false;
  assert.equal(await controller.enter(), false);
  assert.equal(state.locks, 0);
  state.full = true;
  assert.equal(await controller.enter(), true);
  state.full = false;
  controller.exit();
  controller.exit();
  assert.equal(state.locks, 1);
  assert.equal(state.unlocks, 1);
});
test('unsupported or rejected orientation never rejects the fullscreen flow', async () => {
  assert.equal(await orientationSetup({ lock: undefined }).controller.enter(), false);
  assert.equal(await orientationSetup({ lock: () => { throw new Error('NotAllowedError'); } }).controller.enter(), false);
  assert.equal(await orientationSetup({ lock: () => Promise.reject(new Error('NotSupportedError')) }).controller.enter(), false);
});
test('exiting fullscreen during a pending orientation request prevents a lingering lock', async () => {
  let resolve;
  const { state, controller } = orientationSetup({ lock: () => new Promise(done => { resolve = done; }) });
  const pending = controller.enter();
  assert.equal(await controller.enter(), false);
  state.full = false;
  controller.exit();
  const unlocksBeforeResolution = state.unlocks;
  resolve();
  assert.equal(await pending, false);
  assert.equal(state.unlocks, unlocksBeforeResolution + 1);
});

function disclosureSetup({ open = false, reduced = false, supported = true } = {}) {
  const summary = new EventTarget();
  summary.attributes = {};
  summary.setAttribute = (key, value) => { summary.attributes[key] = value; };
  const view = new EventTarget();
  const media = new EventTarget();
  media.matches = reduced;
  const animations = [];
  const details = {
    open, style: {}, dataset: {}, ownerDocument: { defaultView: view },
    querySelector: () => summary,
    getBoundingClientRect() { return { height: this.style.height ? parseFloat(this.style.height) : this.open ? 220 : 32 }; },
    animate: supported ? (frames, options) => {
      const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
      animations.push(animation);
      return animation;
    } : undefined,
  };
  const controls = enhanceDisclosure(details, media);
  const click = () => summary.dispatchEvent(new Event('click', { cancelable: true }));
  return { details, summary, view, media, animations, controls, click };
}
test('disclosure animates opening and closing, then restores natural height', () => {
  const { details, animations, click } = disclosureSetup();
  click();
  assert.equal(details.open, true);
  assert.deepEqual(animations[0].frames, [{ height: '32px' }, { height: '220px' }]);
  animations[0].onfinish();
  assert.equal(details.style.height, '');
  click();
  assert.equal(details.open, true, 'content remains rendered during closing');
  animations[1].onfinish();
  assert.equal(details.open, false);
  assert.equal(details.style.overflow, '');
});
test('rapid clicks reverse from current height and ignore obsolete completion callbacks', () => {
  const { details, animations, click } = disclosureSetup();
  click();
  const oldFinish = animations[0].onfinish;
  details.style.height = '90px';
  click();
  assert.equal(animations[0].cancelled, true);
  assert.equal(animations[1].frames[0].height, '90px');
  oldFinish();
  assert.equal(details.dataset.expanded, 'false');
  animations[1].onfinish();
  assert.equal(details.open, false);
});
test('initial mobile opening animates; rotation settles without overriding later manual closure', () => {
  const { details, animations, view, click } = disclosureSetup({ open: true });
  assert.equal(animations.length, 1);
  view.dispatchEvent(new Event('resize'));
  assert.equal(details.open, true);
  assert.equal(details.style.height, '');
  click();
  view.dispatchEvent(new Event('resize'));
  assert.equal(details.open, false);
  assert.equal(details.style.height, '');
});
test('reduced motion and missing animation API preserve working manual toggles', () => {
  for (const options of [{ reduced: true }, { supported: false }]) {
    const { details, animations, click } = disclosureSetup(options);
    click();
    assert.equal(details.open, true);
    click();
    assert.equal(details.open, false);
    assert.equal(animations.length, 0);
  }
  const { details, media, click } = disclosureSetup();
  click();
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(details.open, true);
  assert.equal(details.style.height, '');
});
function titleSetup(reduced = false) {
  const doc = new EventTarget();
  doc.defaultView = new EventTarget();
  doc.createElement = () => ({
    ownerDocument: doc, children: [], style: {}, attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    appendChild(child) { this.children.push(child); },
    set textContent(value) { this.text = value; this.children = []; },
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this.text; },
  });
  doc.createTextNode = textContent => ({ textContent });
  const title = "Piazza Medaglia d'Oro";
  const element = doc.createElement();
  element.textContent = title;
  const media = new EventTarget();
  media.matches = reduced;
  const pending = new Map();
  let next = 0;
  const timers = {
    setTimeout(fn, at) { pending.set(++next, { fn, at }); return next; },
    clearTimeout(id) { pending.delete(id); },
  };
  typeTitle(element, media, timers);
  function advance(until) {
    for (const [id, task] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (task.at <= until && pending.has(id)) { pending.delete(id); task.fn(); }
    }
  }
  return { doc, element, media, title, pending, advance };
}
test('typewriter preserves accessible name, word boundaries and apostrophe, then restores complete plain text', () => {
  const { element, title, pending, advance } = titleSetup();
  assert.equal(element.children[0].textContent, title);
  const visual = element.children[1];
  assert.equal(visual.attributes['aria-hidden'], 'true');
  assert.equal(visual.textContent, title);
  assert.equal(visual.children.filter(word => word.className === 'typing-word').length, 3);
  const firstLetter = visual.children[0].children[0];
  assert.equal(firstLetter.style.visibility, 'hidden');
  advance(140);
  assert.equal(firstLetter.style.visibility, 'visible');
  advance(2000);
  assert.equal(element.textContent, title);
  assert.equal(element.children.length, 0, 'no hidden or animated spans survive completion');
  assert.equal(pending.size, 0);
  advance(5000);
  assert.equal(element.textContent, title, 'Oro stays visible after the animation');
});
test('interrupted title always settles to complete text and cancels every pending reveal', () => {
  for (const event of ['resize', 'pagehide', 'visibilitychange', 'change']) {
    const { doc, element, media, title, pending, advance } = titleSetup();
    advance(350);
    const target = event === 'change' ? media : event === 'visibilitychange' ? doc : doc.defaultView;
    target.dispatchEvent(new Event(event));
    assert.equal(element.textContent, title, event);
    assert.equal(element.children.length, 0);
    assert.equal(pending.size, 0);
    advance(5000);
    assert.equal(element.textContent, title);
  }
  const reduced = titleSetup(true);
  assert.equal(reduced.element.textContent, reduced.title);
  assert.equal(reduced.element.children.length, 0);
  assert.equal(reduced.pending.size, 0);
});
test('player cancels local zoom gestures but preserves scrolling, single touches and control clicks', () => {
  const viewer = new EventTarget();
  const outside = new EventTarget();
  limitPlayerZoom(viewer);
  function dispatch(target, name, values = {}, cancelable = true) {
    const event = Object.assign(new Event(name, { cancelable }), values);
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }
  for (const name of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
    assert.equal(dispatch(viewer, name), true, name);
    assert.equal(dispatch(outside, name), false, 'outside the player remains unaffected');
  }
  assert.equal(dispatch(viewer, 'wheel', { ctrlKey: true }), true);
  assert.equal(dispatch(viewer, 'wheel', { metaKey: true }), true);
  assert.equal(dispatch(viewer, 'wheel'), false);
  for (const name of ['touchstart', 'touchmove']) {
    assert.equal(dispatch(viewer, name, { touches: [{}, {}] }), true);
    assert.equal(dispatch(viewer, name, { touches: [{}] }), false);
  }
  assert.equal(dispatch(viewer, 'click'), false);
  assert.equal(dispatch(viewer, 'gesturechange', {}, false), false);
});


function pipSetup() {
  const video = new EventTarget(), doc = new EventTarget(), attributes = new Map();
  video.setAttribute = (name, value) => attributes.set(name, value);
  video.removeAttribute = name => attributes.delete(name);
  return { video, doc, attributes };
}
test('PiP is disabled and standard entry exits once even with duplicate events', async () => {
  const { video, doc, attributes } = pipSetup();
  let resolveExit, exits = 0;
  doc.exitPictureInPicture = () => { exits++; return new Promise(resolve => { resolveExit = resolve; }); };
  const dispose = preventPictureInPicture(video, doc);
  assert.equal(video.disablePictureInPicture, true);
  assert.equal(video.autoPictureInPicture, false);
  assert.ok(attributes.has('disablepictureinpicture'));
  doc.pictureInPictureElement = video;
  video.dispatchEvent(new Event('enterpictureinpicture'));
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(exits, 1);
  doc.pictureInPictureElement = null; resolveExit(); await Promise.resolve();
  dispose(); doc.pictureInPictureElement = video;
  video.dispatchEvent(new Event('enterpictureinpicture'));
  assert.equal(exits, 1);
});
test('Safari PiP returns inline while normal fullscreen is left unchanged', () => {
  const { video, doc } = pipSetup();
  const calls = [];
  video.webkitSetPresentationMode = mode => { calls.push(mode); video.webkitPresentationMode = mode; };
  preventPictureInPicture(video, doc);
  video.webkitPresentationMode = 'fullscreen';
  video.dispatchEvent(new Event('webkitpresentationmodechanged'));
  assert.deepEqual(calls, []);
  video.webkitPresentationMode = 'picture-in-picture';
  video.dispatchEvent(new Event('webkitpresentationmodechanged'));
  assert.deepEqual(calls, ['inline']);
});
test('PiP exit rejection and unavailable APIs do not break playback handling', async () => {
  const { video, doc } = pipSetup();
  preventPictureInPicture(video, doc);
  doc.pictureInPictureElement = video;
  video.dispatchEvent(new Event('enterpictureinpicture'));
  doc.exitPictureInPicture = async () => { throw new Error('NotAllowedError'); };
  video.webkitPresentationMode = 'picture-in-picture';
  video.webkitSetPresentationMode = () => { throw new Error('NotSupportedError'); };
  video.dispatchEvent(new Event('enterpictureinpicture'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(video.disablePictureInPicture, true);
});


test('brief buffering retains the current protected frame while prolonged buffering shows a warning', () => {
  assert.deepEqual(playbackPresentation('buffering', {phase:'brief'}),
    {showPreview:false,showMessage:false,keepPrivacy:true,showSpinner:false});
  assert.deepEqual(playbackPresentation('buffering', {phase:'extended'}),
    {showPreview:false,showMessage:true,keepPrivacy:true,showSpinner:true});
  for(const state of ['loading','offline','paused']) {
    const p=playbackPresentation(state);
    assert.equal(p.showPreview,true);assert.equal(p.showMessage,true);assert.equal(p.keepPrivacy,false);
  }
  assert.deepEqual(playbackPresentation('playing'),
    {showPreview:false,showMessage:false,keepPrivacy:true,showSpinner:false});
});
