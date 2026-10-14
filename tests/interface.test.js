import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLandscapeController, enhanceDisclosure, typeTitle } from '../js/interface.js';

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
test('typewriter preserves the full accessible name, word boundaries and apostrophe', () => {
  const doc = {
    createElement() { return { ownerDocument: doc, children: [], style: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, appendChild(child) { this.children.push(child); } }; },
    createTextNode(textContent) { return { textContent }; },
  };
  const element = doc.createElement('span');
  const title = "Piazza Medaglia d'Oro";
  element.textContent = title;
  typeTitle(element, { matches: false });
  assert.equal(element.children[0].textContent, title);
  const visual = element.children[1];
  assert.equal(visual.attributes['aria-hidden'], 'true');
  assert.equal(visual.children.map(word => word.children ? word.children.map(letter => letter.textContent).join('') : word.textContent).join(''), title);
  assert.equal(visual.children.filter(word => word.className === 'typing-word').length, 3);
  const reducedElement = { textContent: title };
  typeTitle(reducedElement, { matches: true });
  assert.equal(reducedElement.textContent, title);
});
