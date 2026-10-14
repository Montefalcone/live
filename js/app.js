import { createLandscapeController } from './interface.js?v=2.10';
import { CAMERA, SHARE_URL } from './config.js?v=2.7';
import { LivePlayer } from './player.js?v=2.1';

const $ = id => document.getElementById(id);
const video = $('liveVideo');
const viewer = $('player');
let nativeFullscreen = false;
let toastTimer;
let fullscreenBusy = false;

const messages = {
  idle: ['PRONTO', 'Webcam pronta', 'Avvia la webcam per guardare la diretta.', 'Guarda la diretta'],
  loading: ['COLLEGAMENTO', 'Collegamento alla webcam…', 'Stiamo collegando la webcam.', null],
  playing: ['LIVE', '', '', null],
  buffering: ['ATTENDI', 'La diretta sta riprendendo.', 'La connessione sta recuperando il video.', null],
  paused: ['IN PAUSA', 'Diretta in pausa', '', 'Riprendi la diretta'],
  suspended: ['SOSPESA', 'Riproduzione sospesa', 'La diretta riprende quando torni su questa scheda.', null],
  offline: ['NON DISPONIBILE', 'Webcam non disponibile', 'Il collegamento alla webcam non è disponibile.', 'Riprova ora'],
  gesture: ['PRONTO', 'Webcam pronta', 'Tocca il pulsante per avviare il video.', 'Guarda la diretta'],
  unsupported: ['NON SUPPORTATO', 'Questo browser non riproduce la diretta.', 'Prova con una versione aggiornata di Safari, Chrome, Edge o Firefox.', null],
};

function render(state, details = {}) {
  const [badge, title, text, action] = messages[state] || messages.offline;
  $('playerStage').dataset.state = state;
  $('statusBadge').dataset.state = state;
  $('statusLabel').textContent = `${badge} - MEDAGLIA D'ORO`;
  $('messageTitle').textContent = title;
  $('messageText').textContent = details.reason === 'network'
    ? 'La connessione Internet è assente. La riproduzione riprenderà quando tornerà disponibile.'
    : details.retryIn ? `${text} Nuovo tentativo tra ${details.retryIn} secondi.` : text;
  $('messageText').hidden = !$('messageText').textContent;
  $('mainActionText').textContent = action || 'Riprova';
  const actionHadFocus = document.activeElement === $('mainAction');
  $('mainAction').hidden = !action;
  $('playerMessage').hidden = state === 'playing';
  $('loadingRing').hidden = !['loading', 'buffering'].includes(state);
  const active = ['loading', 'playing', 'buffering', 'suspended', 'offline'].includes(state);
  $('playIcon').setAttribute('href', active ? '#i-pause' : '#i-play');
  $('playButton').setAttribute('aria-label', active ? 'Metti in pausa' : 'Avvia la diretta');
  $('playButton').title = active ? 'Metti in pausa' : 'Avvia la diretta';
  $('liveButton').dataset.live = String(state === 'playing');
  $('playerAnnouncement').textContent = state === 'playing' ? 'Webcam in diretta.' : `${title} ${$('messageText').textContent}`;
  $('privacyArtwork').hidden = !CAMERA.privacyArtwork || state !== 'playing';
  if (actionHadFocus && !action) $('playButton').focus({ preventScroll: true });
}

const player = new LivePlayer({ video, url: CAMERA.streamUrl, Hls: window.Hls, onState: render });
video.controls = false;
video.poster = CAMERA.poster;
video.muted = true;
if (CAMERA.privacyArtwork) $('privacyArtwork').src = CAMERA.privacyArtwork;
$('playerToolbar').hidden = false;
render('idle');

$('mainAction').addEventListener('click', () => player.start());
$('playButton').addEventListener('click', () => player.wanted ? player.pause() : player.start());
$('liveButton').addEventListener('click', () => player.reconnect());
video.addEventListener('loadedmetadata', () => {
  if (video.videoHeight) $('qualityLabel').textContent = `${video.videoHeight}p · Originale`;
  fitVideoSurface();
});

function visiblePlayback() {
  return nativeFullscreen || document.pictureInPictureElement === video || video.webkitPresentationMode === 'picture-in-picture';
}
function syncVisibility() { player.setHidden(document.hidden && !visiblePlayback()); }
document.addEventListener('visibilitychange', syncVisibility);
video.addEventListener('enterpictureinpicture', syncVisibility);
video.addEventListener('leavepictureinpicture', syncVisibility);
video.addEventListener('webkitpresentationmodechanged', syncVisibility);
window.addEventListener('online', () => player.setOnline(true));
window.addEventListener('offline', () => player.setOnline(false));
window.addEventListener('pagehide', () => player.setHidden(true));
window.addEventListener('pageshow', syncVisibility);

// Keep optional artwork on the actual picture, including letterboxed fullscreen.
function fitVideoSurface() {
  const bounds = $('playerStage').getBoundingClientRect();
  const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
  const width = Math.min(bounds.width, bounds.height * aspect);
  $('videoSurface').style.width = `${width}px`;
  $('videoSurface').style.height = `${width / aspect}px`;
}
if ('ResizeObserver' in window) new ResizeObserver(fitVideoSurface).observe($('playerStage'));
else window.addEventListener('resize', fitVideoSurface);
fitVideoSurface();

const landscape = createLandscapeController({
  orientation: window.screen.orientation,
  isFullscreen: () => Boolean(document.fullscreenElement === viewer || nativeFullscreen || viewer.classList.contains('is-fullscreen-fallback')),
  isMobile: () => window.matchMedia('(pointer: coarse)').matches,
});
window.addEventListener('pagehide', () => landscape.exit());

function fullState() {
  const full = Boolean(document.fullscreenElement || nativeFullscreen || viewer.classList.contains('is-fullscreen-fallback'));
  if (!full) landscape.exit();
  $('fullscreenButton').setAttribute('aria-label', full ? 'Esci da schermo intero' : 'Schermo intero');
  $('fullscreenButton').title = full ? 'Esci da schermo intero' : 'Schermo intero';
  fitVideoSurface();
}
function exitFallback() {
  viewer.classList.remove('is-fullscreen-fallback');
  document.body.classList.remove('fallback-open');
  fullState();
}
$('fullscreenButton').addEventListener('click', async () => {
  if (fullscreenBusy) return;
  fullscreenBusy = true;
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    if (viewer.classList.contains('is-fullscreen-fallback')) { exitFallback(); return; }
    if (viewer.requestFullscreen) {
      try { await viewer.requestFullscreen(); void landscape.enter(); return; } catch { /* Use the fallback below. */ }
    }
    // Native iOS fullscreen has its own controls. Burned-in camera masks remain.
    if (video.webkitEnterFullscreen && video.readyState >= 2) {
      try { video.webkitEnterFullscreen(); return; } catch { /* CSS fallback. */ }
    }
    viewer.classList.add('is-fullscreen-fallback');
    document.body.classList.add('fallback-open');
    void landscape.enter();
  } finally { fullscreenBusy = false; fullState(); }
});
document.addEventListener('fullscreenchange', fullState);
video.addEventListener('webkitbeginfullscreen', () => { nativeFullscreen = true; video.controls = true; syncVisibility(); fullState(); void landscape.enter(); });
video.addEventListener('webkitendfullscreen', () => { nativeFullscreen = false; video.controls = false; syncVisibility(); fullState(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') exitFallback();
  if (event.key === 'Tab' && viewer.classList.contains('is-fullscreen-fallback')) {
    const buttons = [...viewer.querySelectorAll('button')].filter(button => !button.hidden && button.getClientRects().length);
    const first = buttons[0];
    const last = buttons.at(-1);
    if (first && (!viewer.contains(document.activeElement) || (event.shiftKey && document.activeElement === first))) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (last && !event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

function showToast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}
$('shareButton').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ title: 'Webcam Montefalcone di Val Fortore', url: SHARE_URL }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(SHARE_URL);
    showToast('Link della webcam copiato.');
  } catch {
    $('shareUrl').value = SHARE_URL;
    $('shareDialog').showModal();
    $('shareUrl').focus();
    $('shareUrl').select();
  }
});

const timeFormatter = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'long' });
function updateClock() {
  const now = new Date();
  $('localClock').textContent = timeFormatter.format(now);
  $('localClock').dateTime = now.toISOString();
  $('localDate').textContent = dateFormatter.format(now);
}
updateClock();
setInterval(updateClock, 15000);
player.setOnline(navigator.onLine !== false);
syncVisibility();
// Respect explicit browser data-saving requests. Otherwise try muted autoplay.
if (!navigator.connection?.saveData) player.start();
