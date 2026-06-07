"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { CallManager, type CallSignal, type CallStatus } from "@/lib/webrtc";
import type { Message, MessageKind, Reaction } from "@/lib/types";
import ChatHeader from "@/components/ChatHeader";
import MessageBubble from "@/components/MessageBubble";
import Composer from "@/components/Composer";
import CallModal from "@/components/CallModal";

interface Props {
  coupleId: string;
  meId: string;
  partnerName: string;
  initialMessages: Message[];
}

export default function ChatRoom({
  coupleId,
  meId,
  partnerName,
  initialMessages,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [online, setOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);

  // Call state
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callVideo, setCallVideo] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const roomChannelRef = useRef<RealtimeChannel | null>(null);
  const callRef = useRef<CallManager | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageIdsRef = useRef<string[]>([]);

  const isCallerRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const loggedRef = useRef(false);

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

  // ---- Presence / typing / call signaling on one room channel ----
  useEffect(() => {
    const manager = new CallManager({
      send: (signal: CallSignal) =>
        roomChannelRef.current?.send({ type: "broadcast", event: "signal", payload: signal }),
      onStatus: setCallStatus,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onVideoChange: setCallVideo,
    });
    callRef.current = manager;

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
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        manager.handleSignal(payload as CallSignal);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    roomChannelRef.current = channel;

    return () => {
      manager.hangup();
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

  // ---- Send a message ----
  const sendMessage = useCallback(
    async (payload: {
      kind: MessageKind;
      body?: string | null;
      media_path?: string | null;
      reply_to?: string | null;
    }) => {
      const { data } = await supabase
        .from("messages")
        .insert({
          couple_id: coupleId,
          sender_id: meId,
          kind: payload.kind,
          body: payload.body ?? null,
          media_path: payload.media_path ?? null,
          reply_to: payload.reply_to ?? null,
        })
        .select()
        .single();
      if (data) upsertMessage(data as Message);
      setReplyingTo(null);
    },
    [supabase, coupleId, meId, upsertMessage]
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

  const startCall = (video: boolean) => {
    isCallerRef.current = true;
    connectedAtRef.current = null;
    loggedRef.current = false;
    callRef.current?.start(video);
  };
  const acceptCall = () => {
    isCallerRef.current = false;
    callRef.current?.accept();
  };
  const hangup = () => callRef.current?.hangup();
  const toggleMute = () => callRef.current?.toggleMute() ?? false;
  const toggleCamera = () => callRef.current?.toggleCamera() ?? false;

  useEffect(() => {
    if (callStatus === "connected" && connectedAtRef.current === null) {
      connectedAtRef.current = Date.now();
    }
    if (callStatus === "ended" && isCallerRef.current && !loggedRef.current) {
      loggedRef.current = true;
      const start = connectedAtRef.current;
      const seconds = start ? Math.round((Date.now() - start) / 1000) : 0;
      const outcome = start ? "ended" : "missed";
      const body = `${callVideo ? "video" : "voice"}|${outcome}|${seconds}`;
      sendMessage({ kind: "call", body });
      connectedAtRef.current = null;
      isCallerRef.current = false;
    }
  }, [callStatus, callVideo, sendMessage]);

  const inCall =
    callStatus === "calling" || callStatus === "incoming" || callStatus === "connected";

  const messageById = useMemo(() => {
    const map = new Map<string, Message>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col overflow-hidden bg-white dark:bg-neutral-950">
      <ChatHeader
        partnerName={partnerName}
        online={online}
        typing={partnerTyping}
        onAudioCall={() => startCall(false)}
        onVideoCall={() => startCall(true)}
      />

      <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-neutral-400">
            <div className="mb-3 grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 text-3xl text-white">
              {partnerName.charAt(0).toUpperCase()}
            </div>
            <p className="font-semibold text-neutral-700 dark:text-neutral-200">{partnerName}</p>
            <p className="mt-1 text-sm">This is the beginning of your private chat 💜</p>
          </div>
        )}
        {messages.map((m) => (
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

      {inCall && (
        <CallModal
          status={callStatus}
          video={callVideo}
          partnerName={partnerName}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={acceptCall}
          onHangup={hangup}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
        />
      )}
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
