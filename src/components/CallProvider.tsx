"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { CallManager, type CallSignal, type CallStatus } from "@/lib/webrtc";
import CallModal from "@/components/CallModal";

interface CallContextValue {
  startCall: (coupleId: string, partnerName: string, video: boolean) => void;
}

const CallContext = createContext<CallContextValue>({ startCall: () => {} });
export const useCall = () => useContext(CallContext);

// Mounted app-wide: receives incoming calls on any of the user's conversations
// (so the call rings no matter which screen they're on) and owns the one
// active call + the full-screen call UI.
export default function CallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);

  const [status, setStatus] = useState<CallStatus>("idle");
  const [video, setVideo] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [peerName, setPeerName] = useState("Partner");

  const channelsRef = useRef<Map<string, RealtimeChannel>>(new Map());
  const nameByCouple = useRef<Map<string, string>>(new Map());
  const activeCoupleRef = useRef<string | null>(null);
  const callRef = useRef<CallManager | null>(null);
  const isCallerRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const loggedRef = useRef(false);

  // Track the signed-in user.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  // One CallManager for the whole app; routes signals to the active couple.
  useEffect(() => {
    const manager = new CallManager({
      send: (signal: CallSignal) => {
        const cid = activeCoupleRef.current;
        if (!cid) return;
        channelsRef.current.get(cid)?.send({
          type: "broadcast",
          event: "signal",
          payload: { from: userId, signal },
        });
      },
      onStatus: setStatus,
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream,
      onVideoChange: setVideo,
    });
    callRef.current = manager;
    return () => manager.hangup();
  }, [userId]);

  // Subscribe to a call channel for every conversation the user belongs to.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      const { data: couples } = await supabase
        .from("couples")
        .select("*")
        .or(`user_a.eq.${userId},user_b.eq.${userId}`);
      if (cancelled || !couples) return;

      const partnerIds = couples.map((c) =>
        c.user_a === userId ? c.user_b : c.user_a
      );
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", partnerIds);
      const nameById = new Map(
        (profiles ?? []).map((p) => [p.id, p.display_name ?? "Partner"])
      );

      couples.forEach((c) => {
        const pid = c.user_a === userId ? c.user_b : c.user_a;
        nameByCouple.current.set(c.id, nameById.get(pid) ?? "Partner");

        const ch = supabase
          .channel(`call:${c.id}`)
          .on("broadcast", { event: "signal" }, ({ payload }) => {
            if (payload?.from === userId) return;
            const sig = payload.signal as CallSignal;
            if (sig.kind === "offer") {
              // Ignore a new incoming call while already in one.
              if (activeCoupleRef.current && status !== "idle" && status !== "ended")
                return;
              activeCoupleRef.current = c.id;
              setPeerName(nameByCouple.current.get(c.id) ?? "Partner");
              isCallerRef.current = false;
              connectedAtRef.current = null;
              loggedRef.current = false;
            }
            callRef.current?.handleSignal(sig);
          })
          .subscribe();
        channelsRef.current.set(c.id, ch);
      });
    })();

    return () => {
      cancelled = true;
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, supabase]);

  // Log a call entry in the chat when it ends (caller only).
  useEffect(() => {
    if (status === "connected" && connectedAtRef.current === null) {
      connectedAtRef.current = Date.now();
    }
    if (status === "ended" && isCallerRef.current && !loggedRef.current) {
      loggedRef.current = true;
      const cid = activeCoupleRef.current;
      const start = connectedAtRef.current;
      const seconds = start ? Math.round((Date.now() - start) / 1000) : 0;
      const outcome = start ? "ended" : "missed";
      if (cid && userId) {
        supabase
          .from("messages")
          .insert({
            couple_id: cid,
            sender_id: userId,
            kind: "call",
            body: `${video ? "video" : "voice"}|${outcome}|${seconds}`,
          })
          .then(() => {});
      }
      connectedAtRef.current = null;
      isCallerRef.current = false;
    }
  }, [status, video, supabase, userId]);

  const inCall =
    status === "calling" || status === "incoming" || status === "connected";

  // Keep audio alive when the screen turns off or the app is backgrounded.
  // Two mobile-browser hazards during a call:
  //   1. The screen auto-blacks-out after inactivity (no touches during a call),
  //      and once backgrounded the tab is frozen → WebRTC audio stops.
  //   2. A manual lock/background freezes the tab unless an active Media Session
  //      tells the OS that audio is genuinely playing.
  // A Screen Wake Lock fixes (1); a "playing" Media Session fixes (2).
  useEffect(() => {
    if (!inCall) return;

    type WakeLockSentinel = { release: () => Promise<void>; released: boolean };
    type WakeLockNav = Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      const wl = (navigator as WakeLockNav).wakeLock;
      if (!wl) return;
      try {
        const s = await wl.request("screen");
        if (cancelled) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // Wake Lock unsupported or denied (e.g. not visible) — ignore.
      }
    };

    // The OS auto-releases the wake lock when the page is hidden; re-acquire it
    // (and nudge audio playback) as soon as the user returns to the call.
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    // Declare an active media session so the browser keeps audio running in the
    // background and the lock screen shows the call as ongoing audio.
    const ms = navigator.mediaSession;
    if (ms) {
      try {
        ms.metadata = new MediaMetadata({
          title: `${peerName}`,
          artist: video ? "Video call" : "Voice call",
        });
        ms.playbackState = "playing";
        // No-op handlers so the OS doesn't pause/stop our stream.
        ms.setActionHandler("pause", () => {});
        ms.setActionHandler("play", () => {});
      } catch {
        // MediaSession partially unsupported — ignore.
      }
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
      if (ms) {
        ms.playbackState = "none";
        try {
          ms.metadata = null;
          ms.setActionHandler("pause", null);
          ms.setActionHandler("play", null);
        } catch {
          // ignore
        }
      }
    };
  }, [inCall, peerName, video]);

  const startCall = useCallback(
    (coupleId: string, partnerName: string, v: boolean) => {
      activeCoupleRef.current = coupleId;
      setPeerName(partnerName);
      isCallerRef.current = true;
      connectedAtRef.current = null;
      loggedRef.current = false;
      callRef.current?.start(v);
    },
    []
  );

  return (
    <CallContext.Provider value={{ startCall }}>
      {children}
      {inCall && (
        <CallModal
          status={status}
          video={video}
          partnerName={peerName}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={() => callRef.current?.accept()}
          onHangup={() => callRef.current?.hangup()}
          onToggleMute={() => callRef.current?.toggleMute() ?? false}
          onToggleCamera={() => callRef.current?.toggleCamera() ?? false}
        />
      )}
    </CallContext.Provider>
  );
}
