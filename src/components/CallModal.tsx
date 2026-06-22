"use client";

import { useEffect, useRef, useState } from "react";
import type { CallStatus } from "@/lib/webrtc";

interface Props {
  status: CallStatus;
  video: boolean;
  partnerName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  note?: string | null;
  mirrorLocal?: boolean;
  onAccept: () => void;
  onHangup: () => void;
  onToggleMute: () => boolean;
  onToggleCamera: () => boolean;
  onFlipCamera?: () => void;
}

export default function CallModal({
  status,
  video,
  partnerName,
  localStream,
  remoteStream,
  note,
  mirrorLocal = false,
  onAccept,
  onHangup,
  onToggleMute,
  onToggleCamera,
  onFlipCamera,
}: Props) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  // Voice calls start on the earpiece (hold to your ear); video starts on the
  // loudspeaker. `speaker = true` means loudspeaker.
  const [speaker, setSpeaker] = useState(video);
  const routedRef = useRef(false);
  // A bare counter we bump on a timer to force re-renders; the actual values
  // (duration, hangup-arm) are derived from timestamps during render so we never
  // call setState synchronously inside an effect.
  const [, setTick] = useState(0);
  const startRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number | null>(null);

  // Best-effort output routing: tries to switch the remote audio between the
  // loudspeaker and the earpiece. Works where the browser exposes outputs.
  async function applySpeaker(on: boolean) {
    setSpeaker(on);
    const el = remoteAudioRef.current as
      | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
      | null;
    if (!el || typeof el.setSinkId !== "function") return;
    try {
      if (on) {
        await el.setSinkId("");
      } else {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const ear = devices.find(
          (d) =>
            d.kind === "audiooutput" &&
            /ear|receiver|communication/i.test(d.label)
        );
        await el.setSinkId(ear ? ear.deviceId : "default");
      }
    } catch {
      // Routing not supported on this device — toggle is visual only.
    }
  }

  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
  }, [localStream]);

  // Apply the initial audio routing once the call connects: earpiece for voice
  // calls, loudspeaker for video. (Previously routing only happened when the
  // speaker button was tapped, so every call began on the loudspeaker.)
  useEffect(() => {
    if (status === "connected" && remoteStream && !routedRef.current) {
      routedRef.current = true;
      applySpeaker(video);
    }
    if (status !== "connected") routedRef.current = false;
  }, [status, remoteStream, video]);

  useEffect(() => {
    if (remoteRef.current && remoteStream)
      remoteRef.current.srcObject = remoteStream;
  }, [remoteStream, video]);

  // Always play the partner's audio through a dedicated <audio> element, so
  // sound works on voice-only calls (which show an avatar, not a video).
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream)
      remoteAudioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  // Some mobile browsers pause the audio element when the screen locks or the
  // app is backgrounded. Re-issue play() whenever we come back to the front so
  // the partner's voice resumes immediately.
  useEffect(() => {
    const resume = () => {
      const el = remoteAudioRef.current;
      if (el && document.visibilityState === "visible") {
        el.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, []);

  // When the call connects, briefly disarm the End-call button so a stray second
  // tap (left over from tapping Answer) can't immediately hang up. Re-render once
  // after the window so the button re-enables.
  useEffect(() => {
    if (status !== "connected") {
      connectedAtRef.current = null;
      return;
    }
    if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
    const t = setTimeout(() => setTick((n) => n + 1), 800);
    return () => clearTimeout(t);
  }, [status]);

  // Tick once a second while connected so the derived duration updates.
  useEffect(() => {
    if (status !== "connected" && status !== "reconnecting") {
      startRef.current = null;
      return;
    }
    if (startRef.current === null) startRef.current = Date.now();
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const hangupArmed =
    status !== "connected" ||
    (connectedAtRef.current !== null && Date.now() - connectedAtRef.current >= 800);

  const seconds = startRef.current
    ? Math.max(0, Math.floor((Date.now() - startRef.current) / 1000))
    : 0;
  const durationLabel = `${Math.floor(seconds / 60)}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

  const label =
    status === "calling"
      ? "Calling…"
      : status === "incoming"
        ? `${partnerName} is calling`
        : status === "connecting"
          ? "Connecting…"
          : status === "reconnecting"
            ? "Reconnecting…"
            : status === "connected"
              ? durationLabel
              : "";

  // A transient note (No answer / Busy / permission error) takes over the line.
  const statusLine = note || label;

  const initial = partnerName.charAt(0).toUpperCase();

  // Shared touch behaviour: instant press feedback (scale), no 300ms tap delay,
  // no grey tap-highlight box, and not text-selectable.
  const tap =
    "transition active:scale-90 touch-manipulation select-none [-webkit-tap-highlight-color:transparent]";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-neutral-950 p-6 text-white">
      {/* Remote view */}
      <div className="relative flex w-full flex-1 items-center justify-center">
        {/* Partner audio — always present so voice calls have sound. */}
        <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

        {video && remoteStream ? (
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full rounded-2xl bg-black object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="grid h-28 w-28 place-items-center rounded-full bg-rose-500 text-5xl">
              {initial}
            </div>
            <p className="text-xl font-medium">{partnerName}</p>
          </div>
        )}

        {/* Local preview (video calls only) */}
        {video && localStream && (
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className={`absolute bottom-3 right-3 h-32 w-28 rounded-xl bg-black object-contain shadow-lg ${
              mirrorLocal ? "-scale-x-100" : ""
            }`}
          />
        )}
      </div>

      <div className="flex flex-col items-center gap-1 py-3">
        <p className="text-rose-200">{statusLine}</p>
        {muted && status === "connected" && (
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white">
            🔇 You’re muted
          </span>
        )}
      </div>

      {/* Controls */}
      {status === "ended" ? (
        <div className="pb-6" />
      ) : status === "incoming" ? (
        <div className="flex items-end justify-center gap-16 pb-4">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onHangup}
              className={`grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg active:bg-red-700 ${tap}`}
              aria-label="Decline"
            >
              <PhoneIcon down />
            </button>
            <span className="text-xs text-white/70">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={onAccept}
              className={`grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg active:bg-emerald-600 ${tap}`}
              aria-label="Answer"
            >
              <PhoneIcon />
            </button>
            <span className="text-xs text-white/70">Answer</span>
          </div>
        </div>
      ) : (
        <div className="flex items-end justify-center gap-5 pb-2">
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => setMuted(onToggleMute())}
              className={`grid h-14 w-14 place-items-center rounded-full ${tap} ${
                muted ? "bg-white text-neutral-900" : "bg-white/15 text-white active:bg-white/30"
              }`}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              <MicIcon off={muted} />
            </button>
            <span className="text-[11px] text-white/70">{muted ? "Unmute" : "Mute"}</span>
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => applySpeaker(!speaker)}
              className={`grid h-14 w-14 place-items-center rounded-full ${tap} ${
                speaker ? "bg-white text-neutral-900" : "bg-white/15 text-white active:bg-white/30"
              }`}
              aria-label={speaker ? "Switch to earpiece" : "Switch to speaker"}
            >
              <SpeakerIcon off={!speaker} />
            </button>
            <span className="text-[11px] text-white/70">{speaker ? "Speaker" : "Earpiece"}</span>
          </div>

          {video && (
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={() => setCamOff(onToggleCamera())}
                className={`grid h-14 w-14 place-items-center rounded-full ${tap} ${
                  camOff ? "bg-white text-neutral-900" : "bg-white/15 text-white active:bg-white/30"
                }`}
                aria-label={camOff ? "Turn camera on" : "Turn camera off"}
              >
                <CameraIcon off={camOff} />
              </button>
              <span className="text-[11px] text-white/70">{camOff ? "Camera on" : "Camera"}</span>
            </div>
          )}

          {video && onFlipCamera && (
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={onFlipCamera}
                className={`grid h-14 w-14 place-items-center rounded-full bg-white/15 text-white active:bg-white/30 ${tap}`}
                aria-label="Flip camera"
              >
                <FlipIcon />
              </button>
              <span className="text-[11px] text-white/70">Flip</span>
            </div>
          )}

          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => hangupArmed && onHangup()}
              disabled={!hangupArmed}
              className={`grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg active:bg-red-700 disabled:opacity-50 ${tap}`}
              aria-label="End call"
            >
              <PhoneIcon down />
            </button>
            <span className="text-[11px] text-white/70">End</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PhoneIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-7 w-7 ${down ? "rotate-[135deg]" : ""}`}
      fill="currentColor"
    >
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.18z" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h13l-2.5-2.5M21 17H8l2.5 2.5" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function MicIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

function CameraIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      {off && <line x1="2" y1="2" x2="22" y2="22" />}
    </svg>
  );
}

function SpeakerIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {off ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </>
      )}
    </svg>
  );
}
