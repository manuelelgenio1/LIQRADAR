/* Alertas sonoras del radar (WebAudio, sin dependencias).
   El contexto se crea/resume con el primer gesto del usuario. */

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// desbloquea el audio con el primer clic en cualquier parte
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => ensureCtx(), { once: true });
}

function tone(freq: number, at: number, dur: number, gain = 0.055, type: OscillatorType = "sine") {
  const c = ensureCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + at);
  g.gain.setValueAtTime(0, c.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + dur + 0.05);
}

/** giro de rumbo: up = chirrido ascendente · down = descendente */
export function playFlip(dir: "up" | "down") {
  if (dir === "up") {
    tone(523, 0, 0.14);
    tone(784, 0.12, 0.2);
  } else {
    tone(523, 0, 0.14);
    tone(330, 0.12, 0.2);
  }
}

/** entrada en zona magnética: blip corto */
export function playMagnet() {
  tone(880, 0, 0.07, 0.04, "triangle");
  tone(1174, 0.09, 0.09, 0.03, "triangle");
}

/** señal francotirador: triple blip urgente */
export function playSniper() {
  tone(988, 0, 0.07, 0.05, "square");
  tone(988, 0.11, 0.07, 0.05, "square");
  tone(1319, 0.22, 0.16, 0.05, "square");
}

/** confirmación (al activar sonido / probar webhook) */
export function playConfirm() {
  tone(660, 0, 0.09);
}

const KEY = "liqradar-sound";

export function loadSoundPref(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSoundPref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* noop */ }
}
