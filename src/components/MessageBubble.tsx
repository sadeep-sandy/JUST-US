"use client";

import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/storage";
import type { Message, Reaction } from "@/lib/types";

const QUICK = ["❤️", "😂", "👍", "😮", "😢", "🙏"];

function timeLabel(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function previewOf(msg: Message): string {
  switch (msg.kind) {
    case "image":
      return "📷 Photo";
    case "audio":
      return "🎙 Voice message";
    case "file":
      return "📎 " + (msg.body || "File");
    case "call":
      return "📞 Call";
    default:
      return msg.body || "";
  }
}

interface Props {
  message: Message;
  mine: boolean;
  reactions: Reaction[];
  meId: string;
  repliedTo: Message | null;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function MessageBubble({
  message,
  mine,
  reactions,
  meId,
  repliedTo,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => setTime(timeLabel(message.created_at)), [message.created_at]);

  useEffect(() => {
    if (message.media_path && !message.deleted_at) {
      let active = true;
      getSignedUrl(message.media_path).then((u) => active && setUrl(u));
      return () => {
        active = false;
      };
    }
  }, [message.media_path, message.deleted_at]);

  // Call-history entry: centered system chip.
  if (message.kind === "call") {
    const [type, outcome, secStr] = (message.body ?? "voice|ended|0").split("|");
    const secs = parseInt(secStr || "0", 10);
    const mm = Math.floor(secs / 60);
    const ss = (secs % 60).toString().padStart(2, "0");
    const label =
      outcome === "missed"
        ? `Missed ${type} call`
        : `${type === "video" ? "Video" : "Voice"} call · ${mm}:${ss}`;
    return (
      <div className="flex justify-center py-1">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-500 dark:bg-neutral-800">
          {type === "video" ? "🎥" : "📞"} {label}
          {time && <span className="text-neutral-400">· {time}</span>}
        </span>
      </div>
    );
  }

  // Deleted message placeholder.
  if (message.deleted_at) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className="rounded-3xl bg-neutral-100 px-3.5 py-2 text-sm italic text-neutral-400 dark:bg-neutral-800">
          🚫 This message was deleted
        </div>
      </div>
    );
  }

  // Aggregate reactions by emoji.
  const counts = new Map<string, number>();
  let myEmoji: string | null = null;
  reactions.forEach((r) => {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    if (r.user_id === meId) myEmoji = r.emoji;
  });

  const isMedia = message.kind === "image";
  const canEdit = mine && message.kind === "text";

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className="relative max-w-[78%]">
        {/* Reply preview */}
        {repliedTo && (
          <div
            className={`mb-0.5 rounded-xl border-l-2 px-2 py-1 text-xs ${
              mine
                ? "border-fuchsia-300 bg-fuchsia-50 text-neutral-600 dark:bg-neutral-800"
                : "border-violet-300 bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
            }`}
          >
            <span className="line-clamp-1">↩ {previewOf(repliedTo)}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={
            isMedia
              ? "block overflow-hidden rounded-3xl"
              : `block rounded-3xl px-3.5 py-2 text-left ${
                  mine
                    ? "rounded-br-md bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white"
                    : "rounded-bl-md bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                }`
          }
        >
          {message.kind === "text" && (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">
              {message.body}
            </p>
          )}
          {message.kind === "image" &&
            (url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="shared" className="max-h-80 w-full object-cover" />
            ) : (
              <div className="h-48 w-56 animate-pulse bg-neutral-200 dark:bg-neutral-700" />
            ))}
          {message.kind === "audio" &&
            (url ? (
              <audio controls src={url} className="w-56" onClick={(e) => e.stopPropagation()} />
            ) : (
              <div className="h-10 w-56 animate-pulse rounded bg-black/10" />
            ))}
          {message.kind === "file" && (
            <span className="flex items-center gap-2 text-sm underline">
              📎 {message.body || "Attachment"}
            </span>
          )}
        </button>

        {/* Action popover */}
        {open && (
          <div
            className={`absolute z-10 mt-1 flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 ${
              mine ? "right-0" : "left-0"
            }`}
          >
            {QUICK.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onReact(e);
                  setOpen(false);
                }}
                className={`grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  myEmoji === e ? "bg-neutral-100 dark:bg-neutral-800" : ""
                }`}
              >
                {e}
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
            <IconBtn label="Reply" onClick={() => { onReply(); setOpen(false); }}>↩</IconBtn>
            {canEdit && (
              <IconBtn label="Edit" onClick={() => { onEdit(); setOpen(false); }}>✏️</IconBtn>
            )}
            {mine && (
              <IconBtn label="Delete" onClick={() => { onDelete(); setOpen(false); }}>🗑</IconBtn>
            )}
          </div>
        )}

        {/* Reaction chips */}
        {counts.size > 0 && (
          <div className={`mt-0.5 flex flex-wrap gap-1 ${mine ? "justify-end" : "justify-start"}`}>
            {[...counts.entries()].map(([emoji, count]) => (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className={`rounded-full border px-1.5 py-0.5 text-xs ${
                  myEmoji === emoji
                    ? "border-fuchsia-300 bg-fuchsia-50 dark:bg-neutral-800"
                    : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                }`}
              >
                {emoji} {count > 1 ? count : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-neutral-400">
        <span>{time}</span>
        {message.edited_at && <span>· edited</span>}
        {mine && <span>{message.read_at ? "· Seen" : "· Sent"}</span>}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      {children}
    </button>
  );
}
