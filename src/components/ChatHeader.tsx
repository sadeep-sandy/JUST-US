"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Props {
  partnerName: string;
  partnerAvatar: string | null;
  online: boolean;
  typing: boolean;
  lastSeen: string | null;
  disappearSeconds: number;
  onSetDisappear: (seconds: number) => void;
  onAudioCall: () => void;
  onVideoCall: () => void;
  onToggleSearch: () => void;
}

const DISAPPEAR_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "1 hour", value: 3600 },
  { label: "1 day", value: 86400 },
  { label: "1 week", value: 604800 },
];

function lastSeenLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "last seen just now";
  if (mins < 60) return `last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "last seen yesterday";
  if (days < 7) return `last seen ${days}d ago`;
  return "last seen " + new Date(iso).toLocaleDateString();
}

export default function ChatHeader({
  partnerName,
  partnerAvatar,
  online,
  typing,
  lastSeen,
  disappearSeconds,
  onSetDisappear,
  onAudioCall,
  onVideoCall,
  onToggleSearch,
}: Props) {
  const initial = partnerName.charAt(0).toUpperCase();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  let status = " ";
  if (mounted) {
    status = typing
      ? "typing…"
      : online
        ? "Active now"
        : lastSeen
          ? lastSeenLabel(lastSeen)
          : "Offline";
  }

  return (
    <header className="relative flex items-center gap-2 border-b border-neutral-200 bg-white px-2 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
      <Link
        href="/chat"
        aria-label="Back to messages"
        className="grid h-10 w-9 place-items-center rounded-full text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Link>

      <div className="relative">
        {partnerAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={partnerAvatar} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 font-semibold text-white">
            {initial}
          </div>
        )}
        {online && (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-neutral-950" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight text-neutral-900 dark:text-neutral-100">
          {partnerName}
        </p>
        <p
          className={`truncate text-xs ${
            typing ? "text-violet-500" : online ? "text-emerald-500" : "text-neutral-400"
          }`}
        >
          {disappearSeconds > 0 && "⏳ "}
          {status}
        </p>
      </div>

      <IconButton label="Search" onClick={onToggleSearch}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </IconButton>

      <IconButton label="Voice call" onClick={onAudioCall}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </IconButton>

      <IconButton label="Video call" onClick={onVideoCall}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </IconButton>

      <IconButton label="More" onClick={() => setMenuOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </IconButton>

      {menuOpen && (
        <div className="absolute right-2 top-14 z-20 w-52 rounded-2xl border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <p className="px-2 py-1 text-xs font-semibold text-neutral-400">
            ⏳ Disappearing messages
          </p>
          {DISAPPEAR_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onSetDisappear(o.value);
                setMenuOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span>{o.label}</span>
              {disappearSeconds === o.value && <span className="text-fuchsia-500">✓</span>}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}
