"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Live two-player Tic-Tac-Toe played over a Supabase Realtime broadcast
// channel (no database tables involved — moves fly phone-to-phone, exactly
// like the typing indicator). The inviter always plays X and moves first.
// ---------------------------------------------------------------------------

type Phase = "idle" | "inviting" | "invited" | "playing";
type Mark = "X" | "O";
type Cell = Mark | null;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winner(b: Cell[]): Mark | "draw" | null {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a] as Mark;
  }
  return b.every(Boolean) ? "draw" : null;
}

interface GState {
  phase: Phase;
  board: Cell[];
  myMark: Mark | null;
  turn: Mark;
  result: Mark | "draw" | null;
  declined: boolean;
}

const FRESH = (): GState => ({
  phase: "idle",
  board: Array(9).fill(null),
  myMark: null,
  turn: "X",
  result: null,
  declined: false,
});

function applyMove(prev: GState, index: number, mark: Mark): GState {
  if (prev.board[index] || prev.result) return prev;
  const board = prev.board.slice();
  board[index] = mark;
  return {
    ...prev,
    board,
    result: winner(board),
    turn: mark === "X" ? "O" : "X",
  };
}

export interface CoupleGame {
  phase: Phase;
  board: Cell[];
  myMark: Mark | null;
  turn: Mark;
  result: Mark | "draw" | null;
  declined: boolean;
  invite: () => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  play: (index: number) => void;
  rematch: () => void;
  close: () => void;
}

export function useCoupleGame(coupleId: string, meId: string): CoupleGame {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<GState>(FRESH);
  const stateRef = useRef(state);
  const channelRef = useRef<RealtimeChannel | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const send = useCallback((event: string, payload: Record<string, unknown> = {}) => {
    channelRef.current?.send({ type: "broadcast", event, payload: { from: meId, ...payload } });
  }, [meId]);

  useEffect(() => {
    const channel = supabase.channel(`game:${coupleId}`);

    channel
      .on("broadcast", { event: "invite" }, () => {
        // Only surface an invite if we're not already mid-flow.
        if (stateRef.current.phase === "idle") {
          setState({ ...FRESH(), phase: "invited" });
        }
      })
      .on("broadcast", { event: "cancel" }, () => {
        if (stateRef.current.phase === "invited") setState(FRESH());
      })
      .on("broadcast", { event: "accept" }, () => {
        // Partner accepted my invite → I'm the host (X), I move first.
        if (stateRef.current.phase === "inviting") {
          setState({ ...FRESH(), phase: "playing", myMark: "X", turn: "X" });
        }
      })
      .on("broadcast", { event: "decline" }, () => {
        if (stateRef.current.phase === "inviting") {
          setState({ ...FRESH(), declined: true });
          setTimeout(
            () => setState((p) => (p.declined ? FRESH() : p)),
            2600
          );
        }
      })
      .on("broadcast", { event: "move" }, ({ payload }) => {
        const index = payload?.index as number;
        const mark = payload?.mark as Mark;
        if (typeof index !== "number" || (mark !== "X" && mark !== "O")) return;
        setState((p) => (p.phase === "playing" ? applyMove(p, index, mark) : p));
      })
      .on("broadcast", { event: "rematch" }, () => {
        setState((p) =>
          p.myMark
            ? { ...FRESH(), phase: "playing", myMark: p.myMark, turn: "X" }
            : p
        );
      })
      .on("broadcast", { event: "quit" }, () => {
        if (stateRef.current.phase !== "idle") setState(FRESH());
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [supabase, coupleId]);

  const invite = useCallback(() => {
    setState({ ...FRESH(), phase: "inviting", myMark: "X" });
    send("invite");
  }, [send]);

  const cancel = useCallback(() => {
    setState(FRESH());
    send("cancel");
  }, [send]);

  const accept = useCallback(() => {
    // Accepter plays O; host (X) moves first.
    setState({ ...FRESH(), phase: "playing", myMark: "O", turn: "X" });
    send("accept");
  }, [send]);

  const decline = useCallback(() => {
    setState(FRESH());
    send("decline");
  }, [send]);

  const play = useCallback((index: number) => {
    const s = stateRef.current;
    if (s.phase !== "playing" || s.result || s.myMark !== s.turn || s.board[index]) return;
    const mark = s.myMark;
    setState((p) => applyMove(p, index, mark));
    send("move", { index, mark });
  }, [send]);

  const rematch = useCallback(() => {
    setState((p) =>
      p.myMark ? { ...FRESH(), phase: "playing", myMark: p.myMark, turn: "X" } : p
    );
    send("rematch");
  }, [send]);

  const close = useCallback(() => {
    if (stateRef.current.phase !== "idle") send("quit");
    setState(FRESH());
  }, [send]);

  return {
    phase: state.phase,
    board: state.board,
    myMark: state.myMark,
    turn: state.turn,
    result: state.result,
    declined: state.declined,
    invite,
    cancel,
    accept,
    decline,
    play,
    rematch,
    close,
  };
}

export default function GameModal({
  game,
  partnerName,
}: {
  game: CoupleGame;
  partnerName: string;
}) {
  const { phase, declined } = game;
  if (phase === "idle" && !declined) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        {declined && phase === "idle" && (
          <p className="text-center text-sm text-neutral-500">
            {partnerName} isn’t up for a game right now 💤
          </p>
        )}

        {phase === "inviting" && (
          <Centered
            title="Tic-Tac-Toe"
            subtitle={`Waiting for ${partnerName} to join…`}
          >
            <div className="my-4 flex justify-center">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-fuchsia-500 border-t-transparent" />
            </div>
            <Btn variant="ghost" onClick={game.cancel}>Cancel</Btn>
          </Centered>
        )}

        {phase === "invited" && (
          <Centered
            title="🎮 Game invite"
            subtitle={`${partnerName} wants to play Tic-Tac-Toe`}
          >
            <div className="mt-5 flex gap-3">
              <Btn variant="ghost" onClick={game.decline}>Not now</Btn>
              <Btn variant="primary" onClick={game.accept}>Let’s play</Btn>
            </div>
          </Centered>
        )}

        {phase === "playing" && <Board game={game} partnerName={partnerName} />}
      </div>
    </div>
  );
}

function Board({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { board, myMark, turn, result } = game;
  const myTurn = !result && turn === myMark;

  let status: string;
  let tone = "text-neutral-500";
  if (result === "draw") {
    status = "It’s a draw 🤝";
  } else if (result) {
    const iWon = result === myMark;
    status = iWon ? "You win! 🎉" : `${partnerName} wins 😄`;
    tone = iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (myTurn) {
    status = "Your turn";
    tone = "text-emerald-500";
  } else {
    status = `${partnerName}’s turn…`;
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Tic-Tac-Toe</p>
        <p className="text-xs text-neutral-400">You are {myMark}</p>
      </div>
      <p className={`mb-4 text-sm font-medium ${tone}`}>{status}</p>

      <div className="mx-auto grid aspect-square w-full max-w-[260px] grid-cols-3 gap-2">
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => game.play(i)}
            disabled={!myTurn || Boolean(cell)}
            className={`grid place-items-center rounded-2xl text-4xl font-bold transition
              ${cell === "X" ? "text-fuchsia-500" : "text-violet-500"}
              ${
                !cell && myTurn
                  ? "bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                  : "bg-neutral-100 dark:bg-neutral-800"
              }`}
          >
            {cell}
          </button>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {result && (
          <Btn variant="primary" onClick={game.rematch}>Play again</Btn>
        )}
      </div>
    </div>
  );
}

function Centered({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
      <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant: "primary" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
        variant === "primary"
          ? "bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white hover:opacity-90"
          : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}
