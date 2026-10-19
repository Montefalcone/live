// Public URLs only. Never put camera credentials in this repository.
export const CAMERA = Object.freeze({
  id: 'piazza',
  streamUrl: 'https://live.webcammontefalconedivalfortore.it/piazza/index.m3u8',
  poster: './assets/images/piazza-poster-v2.19.webp',
  // Day/night photographic cover; camera masks MUST remain enabled.
  // Set false to return to the original masked video without changing the stream.
  privacyAdaptive: true,
});
export const SHARE_URL = 'https://www.webcammontefalconedivalfortore.it/';
