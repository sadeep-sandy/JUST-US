"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signOut } from "@/app/(auth)/actions";
import type { ConversationSummary } from "@/lib/data";

function preview(c: ConversationSummary): string {
  const p = c.lastMine ? "You: " : "";
  switch (c.lastKind) {
    case "text":
      return p + (c.lastMessage ?? "");
    case "image":
      return p + "📷 Photo";
    case "audio":
      return p + "🎙 Voice message";
    case "file":
      return p + "📎 " + (c.lastMessage ?? "File");
    case "call":
      return p + "📞 Call";
    default:
      return "Say hi 👋";
  }
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ConversationList({
  conversations,
}: {
  userId: string;
  conversations: ConversationSummary[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Keep the inbox live: refresh when a message or a new conversation arrives.
  useEffect(() => {
    const channel = supabase
      .channel("inbox")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "couples" },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col bg-white dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h1 className="text-xl font-bold">Messages</h1>
        <div className="flex items-center gap-1">
          <Link
            href="/pair"
            aria-label="New chat"
            className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white shadow-md"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </Link>
          <form action={signOut}>
            <button
              aria-label="Sign out"
              className="grid h-10 w-10 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </form>
        </div>
      </header>

      {conversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center text-neutral-400">
          <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-3xl text-white">
            💬
          </div>
          <p className="font-semibold text-neutral-700 dark:text-neutral-200">
            No chats yet
          </p>
          <p className="mt-1 text-sm">
            Tap the + button to connect with someone using an invite code.
          </p>
          <Link
            href="/pair"
            className="mt-5 rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 px-5 py-2.5 font-semibold text-white shadow-lg shadow-violet-500/25"
          >
            Start a chat
          </Link>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-xl font-semibold text-white">
                  {c.partnerName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
                      {c.partnerName}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {mounted ? timeLabel(c.lastAt) : ""}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`truncate text-sm ${
                        c.unread > 0
                          ? "font-semibold text-neutral-900 dark:text-neutral-100"
                          : "text-neutral-500"
                      }`}
                    >
                      {preview(c)}
                    </span>
                    {c.unread > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-fuchsia-500 px-1.5 text-xs font-semibold text-white">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
