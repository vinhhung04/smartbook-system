// Audible + haptic confirmation for barcode/location scans on warehouse screens.
// No external audio assets: a short Web Audio oscillator beep, paired with
// navigator.vibrate where the device supports it. Both are best-effort — a
// desktop browser with no vibration API, or a page that hasn't captured a user
// gesture yet for AudioContext, silently no-ops rather than throwing, since
// feedback is a nicety and must never interrupt the scan flow.

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!audioContext) {
    try {
      audioContext = new AudioContextCtor();
    } catch {
      return null;
    }
  }
  return audioContext;
}

function beep(frequency: number, durationMs: number, volume = 0.15) {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = volume;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    // Ignore — a failed beep should never break the scan flow.
  }
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Some browsers throw when called outside a user gesture; ignore.
    }
  }
}

/** Short high beep + a light tap — a scan matched what was expected. */
export function playScanSuccess() {
  beep(1046.5, 90);
  vibrate(40);
}

/** Two short low beeps + a longer buzz — a scan was rejected (wrong location/product/code). */
export function playScanError() {
  beep(220, 100);
  window.setTimeout(() => beep(220, 100), 130);
  vibrate([60, 60, 60]);
}
