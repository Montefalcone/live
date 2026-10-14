// Progressive UI effects: the static title and native details work without JS.
export function typeTitle(element, reducedMotion, timers = globalThis) {
  if (!element || reducedMotion.matches) return;
  const text = element.textContent;
  const doc = element.ownerDocument;
  const accessibleText = doc.createElement('span');
  accessibleText.className = 'sr-only';
  accessibleText.textContent = text;
  const visualText = doc.createElement('span');
  visualText.setAttribute('aria-hidden', 'true');
  const scheduled = [];
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    scheduled.forEach(id => timers.clearTimeout(id));
    // The settled title must be ordinary text, with no hidden glyphs or fill state.
    element.textContent = text;
    doc.removeEventListener?.('visibilitychange', finish);
    doc.defaultView?.removeEventListener('pagehide', finish);
    doc.defaultView?.removeEventListener('resize', finish);
    if (reducedMotion.removeEventListener) reducedMotion.removeEventListener('change', finish);
    else reducedMotion.removeListener?.(finish);
  }
  let index = 0;
  for (const token of text.split(/(\s+)/)) {
    if (/^\s+$/.test(token)) {
      visualText.appendChild(doc.createTextNode(token));
      index += token.length;
      continue;
    }
    const word = doc.createElement('span');
    word.className = 'typing-word';
    for (const character of token) {
      const letter = doc.createElement('span');
      letter.className = 'typing-letter';
      letter.textContent = character;
      letter.style.visibility = 'hidden';
      scheduled.push(timers.setTimeout(() => {
        if (!finished) letter.style.visibility = 'visible';
      }, 140 + index++ * 48));
      word.appendChild(letter);
    }
    visualText.appendChild(word);
  }
  element.textContent = '';
  element.appendChild(accessibleText);
  element.appendChild(visualText);
  scheduled.push(timers.setTimeout(finish, 140 + index * 48));
  doc.addEventListener?.('visibilitychange', finish);
  doc.defaultView?.addEventListener('pagehide', finish);
  doc.defaultView?.addEventListener('resize', finish);
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', finish);
  else reducedMotion.addListener?.(finish);
  return finish;
}

// Best effort inside the page only: browser/OS zoom and native video fullscreen
// cannot be secured by page JavaScript. Privacy masks belong in the source video.
export function limitPlayerZoom(viewer) {
  if (!viewer) return;
  const prevent = event => { if (event.cancelable) event.preventDefault(); };
  const options = { passive: false, capture: true };
  viewer.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) prevent(event);
  }, options);
  for (const name of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) {
    viewer.addEventListener(name, prevent, options);
  }
  for (const name of ['touchstart', 'touchmove']) {
    viewer.addEventListener(name, event => {
      if (event.touches.length > 1) prevent(event);
    }, options);
  }
}

export function enhanceDisclosure(details, reducedMotion) {
  const summary = details.querySelector('summary');
  let targetOpen = details.open;
  let animation = null;
  let generation = 0;

  function cancelAnimation() {
    if (!animation) return;
    animation.onfinish = null;
    animation.oncancel = null;
    animation.cancel();
    animation = null;
  }
  function finish(open) {
    generation++;
    cancelAnimation();
    targetOpen = open;
    details.open = open;
    details.style.height = '';
    details.style.overflow = '';
    summary.setAttribute('aria-expanded', String(open));
    details.dataset.expanded = String(open);
  }
  function setOpen(open, animate = true) {
    const start = details.getBoundingClientRect().height;
    cancelAnimation();
    const token = ++generation;
    targetOpen = open;
    if (!animate || reducedMotion.matches || typeof details.animate !== 'function') {
      finish(open);
      return;
    }
    // Measure the real target, including wrapped text and the desktop height cap.
    details.style.height = '';
    details.style.overflow = '';
    details.open = open;
    const end = details.getBoundingClientRect().height;
    details.open = true;
    summary.setAttribute('aria-expanded', String(open));
    details.dataset.expanded = String(open);
    details.style.height = `${start}px`;
    details.style.overflow = 'hidden';
    try {
      animation = details.animate(
        [{ height: `${start}px` }, { height: `${end}px` }],
        { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      );
      animation.onfinish = () => { if (token === generation) finish(open); };
      animation.oncancel = () => { if (token === generation) finish(open); };
    } catch { finish(open); }
  }
  summary.addEventListener('click', event => {
    event.preventDefault();
    setOpen(!targetOpen);
  });
  const settle = () => finish(targetOpen);
  // Rotation/resize must not leave a stale pixel height or override user choice.
  details.ownerDocument.defaultView.addEventListener('resize', settle);
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', settle);
  else if (reducedMotion.addListener) reducedMotion.addListener(settle);
  const initiallyOpen = targetOpen;
  finish(false);
  if (initiallyOpen) setOpen(true);
  return { setOpen, settle };
}

export function createLandscapeController({ orientation, isFullscreen, isMobile }) {
  let generation = 0;
  let requested = false;
  let pending = false;
  function unlock() {
    try { orientation?.unlock?.(); } catch { /* The platform may refuse. */ }
  }
  return {
    async enter() {
      if (pending || !isMobile() || !isFullscreen() || typeof orientation?.lock !== 'function') return false;
      const token = ++generation;
      pending = true;
      requested = true;
      try {
        await orientation.lock('landscape');
        if (token !== generation || !isFullscreen()) {
          if (!isFullscreen()) unlock();
          return false;
        }
        return true;
      } catch {
        if (token === generation) requested = false;
        return false;
      } finally {
        if (token === generation) pending = false;
      }
    },
    exit() {
      generation++;
      pending = false;
      if (requested) unlock();
      requested = false;
    },
  };
}

if (typeof document !== 'undefined') {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  typeTitle(document.getElementById('cameraName'), reducedMotion);
  limitPlayerZoom(document.getElementById('player'));
  const details = document.getElementById('aboutVillage');
  if (details) enhanceDisclosure(details, reducedMotion);
}
