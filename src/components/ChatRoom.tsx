"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getWallpaperKey, wallpaperBackground } from "@/lib/theme";
import { useCall } from "@/components/CallProvider";
import type { Message, MessageKind, Reaction } from "@/lib/types";
import ChatHeader from "@/components/ChatHeader";
import MessageBubble from "@/components/MessageBubble";
import Composer from "@/components/Composer";

interface Props {
  coupleId: string;
  meId: string;
  partnerId: string;
  partnerName: string;
  partnerAvatar: string | null;
  partnerLastSeen: string | null;
  disappearSeconds: number;
  initialMessages: Message[];
}

export default function ChatRoom({
  coupleId,
  meId,
  partnerId,
  partnerName,
  partnerAvatar,
  partnerLastSeen: initialLastSeen,
  disappearSeconds: initialDisappear,
  initialMessages,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [online, setOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(initialLastSeen);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [disappearSeconds, setDisappearSeconds] = useState(initialDisappear);
  const [wallpaper, setWallpaper] = useState("");

  const { startCall } = useCall();

  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageIdsRef = useRef<string[]>([]);

  const upsertMessage = useCallback((m: Message) => {
    setMessages((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx === -1) return [...prev, m];
      const next = [...prev];
      next[idx] = m;
      return next;
    });
  }, []);

  // ---- Reactions loading ----
  const loadReactions = useCallback(async () => {
    const ids = messageIdsRef.current;
    if (ids.length === 0) return;
    const { data } = await supabase
      .from("reactions")
      .select("*")
      .in("message_id", ids);
    const map: Record<string, Reaction[]> = {};
    (data as Reaction[] | null)?.forEach((r) => {
      (map[r.message_id] ||= []).push(r);
    });
    setReactions(map);
  }, [supabase]);

  useEffect(() => {
    messageIdsRef.current = messages.map((m) => m.id);
  }, [messages]);

  useEffect(() => {
    loadReactions();
  }, [loadReactions]);

  // ---- Database realtime: messages + reactions ----
  useEffect(() => {
    const channel = supabase
      .channel(`db:${coupleId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `couple_id=eq.${coupleId}` },
        (payload) => upsertMessage(payload.new as Message)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `couple_id=eq.${coupleId}` },
        (payload) => upsertMessage(payload.new as Message)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reactions" },
        () => loadReactions()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, coupleId, upsertMessage, loadReactions]);

  // ---- Presence / typing on one room channel (calls are handled globally) ----
  useEffect(() => {
    const channel = supabase.channel(`room:${coupleId}`, {
      config: { presence: { key: meId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const others = Object.keys(state).filter((k) => k !== meId);
        setOnline(others.length > 0);
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.from === meId) return;
        setPartnerTyping(Boolean(payload?.typing));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    roomChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      roomChannelRef.current = null;
    };
  }, [supabase, coupleId, meId]);

  // ---- Auto-scroll to newest ----
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, partnerTyping]);

  // ---- Read receipts (via RPC, so only read_at is touched) ----
  useEffect(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    const hasUnread = messages.some((m) => m.sender_id !== meId && m.read_at === null);
    if (!hasUnread) return;
    supabase.rpc("mark_read", { p_couple: coupleId }).then(() => {});
  }, [messages, meId, coupleId, supabase]);

  // ---- Heartbeat: keep my "last seen" fresh while the app is open ----
  useEffect(() => {
    const beat = () =>
      supabase
        .from("profiles")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", meId)
        .then(() => {});
    beat();
    const interval = setInterval(beat, 25000);
    return () => clearInterval(interval);
  }, [supabase, meId]);

  // ---- When the partner goes offline, fetch their latest "last seen" ----
  useEffect(() => {
    if (online) return;
    supabase
      .from("profiles")
      .select("last_seen")
      .eq("id", partnerId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.last_seen) setPartnerLastSeen(data.last_seen);
      });
  }, [online, partnerId, supabase]);

  // ---- Wallpaper (per-device) ----
  useEffect(() => {
    setWallpaper(wallpaperBackground(getWallpaperKey()));
  }, []);

  // ---- Disappearing messages: purge expired on load + periodically ----
  useEffect(() => {
    if (disappearSeconds <= 0) return;
    const purge = () =>
      supabase.rpc("purge_expired", { p_couple: coupleId }).then(() => {
        setMessages((prev) =>
          prev.filter((m) => !m.expires_at || new Date(m.expires_at) > new Date())
        );
      });
    purge();
    const interval = setInterval(purge, 30000);
    return () => clearInterval(interval);
  }, [supabase, coupleId, disappearSeconds]);

  // ---- Send a message ----
  const sendMessage = useCallback(
    async (payload: {
      kind: MessageKind;
      body?: string | null;
      media_path?: string | null;
      reply_to?: string | null;
    }) => {
      const expires_at =
        disappearSeconds > 0
          ? new Date(Date.now() + disappearSeconds * 1000).toISOString()
          : null;
      const { data } = await supabase
        .from("messages")
        .insert({
          couple_id: coupleId,
          sender_id: meId,
          kind: payload.kind,
          body: payload.body ?? null,
          media_path: payload.media_path ?? null,
          reply_to: payload.reply_to ?? null,
          expires_at,
        })
        .select()
        .single();
      if (data) upsertMessage(data as Message);
      setReplyingTo(null);
    },
    [supabase, coupleId, meId, upsertMessage, disappearSeconds]
  );

  const setDisappear = useCallback(
    async (seconds: number) => {
      setDisappearSeconds(seconds);
      await supabase
        .from("couples")
        .update({ disappear_seconds: seconds })
        .eq("id", coupleId);
    },
    [supabase, coupleId]
  );

  // ---- Reactions / edit / delete ----
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const mine = reactions[messageId]?.find((r) => r.user_id === meId);
      if (mine && mine.emoji === emoji) {
        await supabase.from("reactions").delete().eq("message_id", messageId).eq("user_id", meId);
      } else {
        await supabase
          .from("reactions")
          .upsert({ message_id: messageId, user_id: meId, emoji });
      }
      loadReactions();
    },
    [supabase, meId, reactions, loadReactions]
  );

  const deleteMessage = useCallback(
    async (id: string) => {
      await supabase
        .from("messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
    },
    [supabase]
  );

  const submitEdit = useCallback(
    async (newBody: string) => {
      if (!editing) return;
      await supabase
        .from("messages")
        .update({ body: newBody, edited_at: new Date().toISOString() })
        .eq("id", editing.id);
      setEditing(null);
    },
    [supabase, editing]
  );

  // ---- Typing broadcast ----
  const notifyTyping = useCallback(() => {
    const ch = roomChannelRef.current;
    if (!ch) return;
    ch.send({ type: "broadcast", event: "typing", payload: { from: meId, typing: true } });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      ch.send({ type: "broadcast", event: "typing", payload: { from: meId, typing: false } });
    }, 1500);
  }, [meId]);

  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const q = query.trim().toLowerCase();
  const now = Date.now();
  const notExpired = (m: Message) =>
    !m.expires_at || new Date(m.expires_at).getTime() > now;
  const displayMessages = (
    q
      ? messages.filter(
          (m) =>
            m.kind === "text" &&
            !m.deleted_at &&
            (m.body ?? "").toLowerCase().includes(q)
        )
      : messages
  ).filter(notExpired);

  return (
    <div className="fixed inset-0 z-0 flex justify-center bg-white dark:bg-neutral-950">
    <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <ChatHeader
        partnerName={partnerName}
        partnerAvatar={partnerAvatar}
        online={online}
        typing={partnerTyping}
        lastSeen={partnerLastSeen}
        disappearSeconds={disappearSeconds}
        onSetDisappear={setDisappear}
        onAudioCall={() => startCall(coupleId, partnerName, false)}
        onVideoCall={() => startCall(coupleId, partnerName, true)}
        onToggleSearch={() => {
          setSearchOpen((s) => !s);
          setQuery("");
        }}
      />

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages…"
            className="field"
          />
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            className="shrink-0 px-2 text-sm text-neutral-500"
          >
            Cancel
          </button>
        </div>
      )}

      <div
        className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4"
        style={wallpaper ? { background: wallpaper } : undefined}
      >
        {q && displayMessages.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-400">
            No messages match “{query}”.
          </p>
        )}
        {!q && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-neutral-400">
            <div className="mb-3 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-3xl text-white">
              {partnerName.charAt(0).toUpperCase()}
            </div>
            <p className="font-semibold text-neutral-700 dark:text-neutral-200">{partnerName}</p>
            <p className="mt-1 text-sm">This is the beginning of your private chat 💜</p>
          </div>
        )}
        {displayMessages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.sender_id === meId}
            reactions={reactions[m.id] ?? []}
            meId={meId}
            repliedTo={m.reply_to ? messageById.get(m.reply_to) ?? null : null}
            onReact={(emoji) => toggleReaction(m.id, emoji)}
            onReply={() => setReplyingTo(m)}
            onEdit={() => setEditing(m)}
            onDelete={() => deleteMessage(m.id)}
          />
        ))}
        {partnerTyping && (
          <div className="inline-flex items-center gap-1 rounded-3xl rounded-bl-md bg-neutral-100 px-4 py-3 dark:bg-neutral-800">
            <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <Composer
        coupleId={coupleId}
        onSend={sendMessage}
        onTyping={notifyTyping}
        replyingTo={replyingTo}
        editing={editing}
        meId={meId}
        partnerName={partnerName}
        onCancelReply={() => setReplyingTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSubmitEdit={submitEdit}
      />
    </div>
    </div>
  );
}

function Dot({ delay = "0ms" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
      style={{ animationDelay: delay }}
    />
  );
}
