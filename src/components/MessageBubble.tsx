"use client";

import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/storage";
import type { Message } from "@/lib/types";

function timeLabel(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

export default function MessageBubble({
  message,
  mine,
}: {
  message: Message;
  mine: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  // Render the timestamp only after mount so the server (which may use a
  // different locale/timezone) and the client agree — avoids hydration errors.
  const [time, setTime] = useState("");
  useEffect(() => {
    setTime(timeLabel(message.created_at));
  }, [message.created_at]);

  useEffect(() => {
    if (message.media_path) {
      let active = true;
      getSignedUrl(message.media_path).then((u) => {
        if (active) setUrl(u);
      });
      return () => {
        active = false;
      };
    }
  }, [message.media_path]);

  // Call-history entry: render as a centered system chip.
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

  const isMedia = message.kind === "image";

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={
          isMedia
            ? "max-w-[75%] overflow-hidden rounded-3xl"
            : `max-w-[75%] rounded-3xl px-3.5 py-2 ${
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
            <audio controls src={url} className="w-56" />
          ) : (
            <div className="h-10 w-56 animate-pulse rounded bg-black/10" />
          ))}

        {message.kind === "file" && (
          <a
            href={url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm underline"
          >
            📎 {message.body || "Attachment"}
          </a>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1 px-1 text-[10px] text-neutral-400">
        <span>{time}</span>
        {mine && <span>{message.read_at ? "Seen" : "Sent"}</span>}
      </div>
    </div>
  );
}
