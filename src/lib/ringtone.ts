// Synthesized call tones — no audio files needed. A repeating two-tone ring
// for incoming calls (with vibration) and a softer ringback for outgoing ones.
//
// Note: mobile browsers may block audio until the user has interacted with the
// page, and won't play while the tab is backgrounded. This is best-effort.

let ctx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;
let vibrateTimer: ReturnType<typeof setInterval> | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// One ring burst: a 440Hz + 480Hz pair held ~1s with soft fade in/out.
function burst(kind: "incoming" | "outgoing") {
  const c = audio();
  if (!c) return;
  const now = c.currentTime;
  const vol = kind === "incoming" ? 0.18 : 0.1;
  const gain = c.createGain();
  gain.connect(c.destination);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.06);
  gain.gain.setValueAtTime(vol, now + 1.0);
  gain.gain.linearRampToValueAtTime(0, now + 1.1);
  for (const freq of [440, 480]) {
    const osc = c.createOscillator();
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 1.15);
  }
}

export function startRinging(kind: "incoming" | "outgoing") {
  stopRinging();
  burst(kind);
  // Ring cadence: incoming every 2s, outgoing (ringback) every 3s.
  ringTimer = setInterval(() => burst(kind), kind === "incoming" ? 2000 : 3000);

  if (kind === "incoming" && typeof navigator !== "undefined" && navigator.vibrate) {
    const buzz = () => navigator.vibrate?.([400, 200, 400]);
    buzz();
    vibrateTimer = setInterval(buzz, 2000);
  }
}

export function stopRinging() {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
  if (vibrateTimer) {
    clearInterval(vibrateTimer);
    vibrateTimer = null;
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(0);
}
