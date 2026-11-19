// UI sounds, synthesised with the Web Audio API (no audio files to download).
//
// downloadComplete(): a short "landed" cue for when a download finishes: a soft thump as something
// settles, then a bright two-note chime that rises and rings out. It is an original sound, inspired
// by "Landed" on bencho.dev; Bencho's own sounds can only be downloaded with a Bencho Pro account,
// so if you have one, put the WAV in the site and set CONFIG.sounds.downloadComplete to its path
// (e.g. 'sounds/landed.wav') to play that file instead.
//
// Browsers only allow audio after a user gesture, so call primeAudio() from a tap (e.g. when the
// download starts); the sound can then play later when the download finishes.
import { CONFIG } from './config.js';
import * as store from './storage.js';

/** @type {AudioContext | null} */
let ctx = null;
/** @type {AudioBuffer | null} */
let fileBuffer = null;
let fileTried = false;

export const soundsEnabled = () => store.getSettings().sounds !== false;
export function setSoundsEnabled(on) { store.setSetting('sounds', !!on); }

/** Create/resume the audio context. Must be called from a user gesture at least once. */
export function primeAudio() {
  try {
    const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!fileTried && CONFIG.sounds?.downloadComplete) loadFile(CONFIG.sounds.downloadComplete);
  } catch { /* no audio on this device */ }
}

async function loadFile(url) {
  fileTried = true;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    fileBuffer = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch { fileBuffer = null; }
}

function tone(t0, { freq, from = freq, dur, peak, type = 'sine', glide = 0.04 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(freq, t0 + glide);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function thump(t0) {
  // 40 ms of filtered noise: the "landing"
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(lp).connect(g).connect(ctx.destination);
  src.start(t0);
  tone(t0, { freq: 110, from: 190, dur: 0.12, peak: 0.25, glide: 0.07 });
}

/** Play the "download complete" cue (no-op if sounds are off or audio is unavailable). */
export function downloadComplete() {
  if (!soundsEnabled()) return;
  try {
    primeAudio();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    if (fileBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = fileBuffer;
      src.connect(ctx.destination);
      src.start(t);
      return;
    }
    thump(t);
    tone(t + 0.05, { freq: 1046.5, from: 1240, dur: 0.32, peak: 0.12, type: 'triangle' }); // C6, settling down onto it
    tone(t + 0.13, { freq: 1568, dur: 0.55, peak: 0.08 });                                 // G6 rings out
    tone(t + 0.13, { freq: 3136, dur: 0.25, peak: 0.015 });                                // a little shimmer
  } catch { /* ignore */ }
}
