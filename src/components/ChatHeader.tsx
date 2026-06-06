"use client";

import Link from "next/link";

interface Props {
  partnerName: string;
  online: boolean;
  typing: boolean;
  onAudioCall: () => void;
  onVideoCall: () => void;
}

export default function ChatHeader({
  partnerName,
  online,
  typing,
  onAudioCall,
  onVideoCall,
}: Props) {
  const initial = partnerName.charAt(0).toUpperCase();
  const status = typing ? "typing…" : online ? "Active now" : "Offline";

  return (
    <header className="flex items-center gap-2 border-b border-neutral-200 bg-white px-2 py-2.5 dark:border-neutral-800 dark:bg-neutral-950">
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
        <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 font-semibold text-white">
          {initial}
        </div>
        {online && (
          <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-neutral-950" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold leading-tight text-neutral-900 dark:text-neutral-100">
          {partnerName}
        </p>
        <p
          className={`text-xs ${
            typing
              ? "text-violet-500"
              : online
                ? "text-emerald-500"
                : "text-neutral-400"
          }`}
        >
          {status}
        </p>
      </div>

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
      className="grid h-10 w-10 place-items-center rounded-full text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}
