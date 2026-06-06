"use client";

import { useEffect, useRef, useState } from "react";
import type { CallStatus } from "@/lib/webrtc";

interface Props {
  status: CallStatus;
  video: boolean;
  partnerName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onHangup: () => void;
  onToggleMute: () => boolean;
  onToggleCamera: () => boolean;
}

export default function CallModal({
  status,
  video,
  partnerName,
  localStream,
  remoteStream,
  onAccept,
  onHangup,
  onToggleMute,
  onToggleCamera,
}: Props) {
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);

  useEffect(() => {
    if (localRef.current && localStream) localRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteStream)
      remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  const label =
    status === "calling"
      ? "Calling…"
      : status === "incoming"
        ? `${partnerName} is calling`
        : status === "connected"
          ? "Connected"
          : "";

  const initial = partnerName.charAt(0).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-neutral-950 p-6 text-white">
      {/* Remote view */}
      <div className="relative flex w-full flex-1 items-center justify-center">
        {video && remoteStream ? (
          <video
            ref={remoteRef}
            autoPlay
            playsInline
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
            className="absolute bottom-3 right-3 h-32 w-28 rounded-xl bg-black object-contain shadow-lg"
          />
        )}
      </div>

      <p className="py-3 text-rose-200">{label}</p>

      {/* Controls */}
      <div className="flex items-center gap-5 pb-2">
        {status === "incoming" ? (
          <>
            <button
              onClick={onHangup}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700"
              aria-label="Decline"
            >
              <PhoneIcon down />
            </button>
            <button
              onClick={onAccept}
              className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg transition hover:bg-emerald-600"
              aria-label="Accept"
            >
              <PhoneIcon />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setMuted(onToggleMute())}
              className={`grid h-14 w-14 place-items-center rounded-full transition ${
                muted ? "bg-white text-neutral-900" : "bg-white/15 text-white hover:bg-white/25"
              }`}
              aria-label="Mute"
            >
              <MicIcon off={muted} />
            </button>
            {video && (
              <button
                onClick={() => setCamOff(onToggleCamera())}
                className={`grid h-14 w-14 place-items-center rounded-full transition ${
                  camOff ? "bg-white text-neutral-900" : "bg-white/15 text-white hover:bg-white/25"
                }`}
                aria-label="Toggle camera"
              >
                <CameraIcon off={camOff} />
              </button>
            )}
            <button
              onClick={onHangup}
              className="grid h-16 w-16 place-items-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700"
              aria-label="End call"
            >
              <PhoneIcon down />
            </button>
          </>
        )}
      </div>
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
