"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Live two-player games over a Supabase Realtime broadcast channel
// (game:<coupleId>) — no database tables, moves fly phone-to-phone like the
// typing indicator. Pick a game, invite your partner, play live.
//
// Adding a new game = add an entry to GAMES, a state init in makeState(), the
// move handlers, and a <Board> renderer. Everything else is shared.
// ---------------------------------------------------------------------------

export type GameId = "ttt" | "rps" | "c4";

export const GAMES: { id: GameId; name: string; emoji: string; blurb: string }[] = [
  { id: "ttt", name: "Tic-Tac-Toe", emoji: "⭕", blurb: "Classic 3-in-a-row" },
  { id: "c4", name: "Connect Four", emoji: "🔴", blurb: "Drop 4 in a row" },
  { id: "rps", name: "Rock Paper Scissors", emoji: "✊", blurb: "Quick best-of throws" },
];

type Phase = "idle" | "picking" | "inviting" | "invited" | "playing";
type Mark = "X" | "O";
type Cell = Mark | null;
type Throw = "rock" | "paper" | "scissors";
type Disc = "R" | "Y"; // Connect Four: Red (host, first) vs Yellow (guest)

const C4_COLS = 7;
const C4_ROWS = 6;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function tttWinner(b: Cell[]): Mark | "draw" | null {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a] as Mark;
  }
  return b.every(Boolean) ? "draw" : null;
}

const BEATS: Record<Throw, Throw> = { rock: "scissors", paper: "rock", scissors: "paper" };
function rpsOutcome(mine: Throw, theirs: Throw): "win" | "lose" | "draw" {
  if (mine === theirs) return "draw";
  return BEATS[mine] === theirs ? "win" : "lose";
}

// Connect Four win check: scan every cell for 4 in a row in any direction.
function c4Winner(b: (Disc | null)[]): Disc | "draw" | null {
  const at = (r: number, c: number) =>
    r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS ? b[r * C4_COLS + c] : null;
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const v = at(r, c);
      if (!v) continue;
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let k = 1;
        while (k < 4 && at(r + dr * k, c + dc * k) === v) k++;
        if (k === 4) return v;
      }
    }
  }
  return b.every(Boolean) ? "draw" : null;
}

interface GState {
  phase: Phase;
  game: GameId | null;
  // tic-tac-toe
  board: Cell[];
  myMark: Mark | null;
  turn: Mark;
  tttResult: Mark | "draw" | null;
  // rock-paper-scissors
  myThrow: Throw | null;
  theirThrow: Throw | null;
  myScore: number;
  theirScore: number;
  scored: boolean;
  // connect four
  c4board: (Disc | null)[];
  c4Disc: Disc | null;
  c4Turn: Disc;
  c4Result: Disc | "draw" | null;
  // shared
  declined: boolean;
}

const FRESH = (): GState => ({
  phase: "idle",
  game: null,
  board: Array(9).fill(null),
  myMark: null,
  turn: "X",
  tttResult: null,
  myThrow: null,
  theirThrow: null,
  myScore: 0,
  theirScore: 0,
  scored: false,
  c4board: Array(C4_COLS * C4_ROWS).fill(null),
  c4Disc: null,
  c4Turn: "R",
  c4Result: null,
  declined: false,
});

// Builds a fresh per-game state for a given phase. `role` decides who plays
// first: Tic-Tac-Toe host = X, Connect Four host = R (Red).
function makeState(phase: Phase, game: GameId, role: "host" | "guest"): GState {
  const base = { ...FRESH(), phase, game };
  if (game === "ttt") return { ...base, myMark: role === "host" ? "X" : "O", turn: "X" };
  if (game === "c4") return { ...base, c4Disc: role === "host" ? "R" : "Y", c4Turn: "R" };
  return base;
}

// Derives host/guest from the player's assigned colour/mark, so a rematch keeps
// the same sides.
function roleOf(p: GState): "host" | "guest" {
  if (p.game === "c4") return p.c4Disc === "R" ? "host" : "guest";
  return p.myMark === "X" ? "host" : "guest";
}

function applyTttMove(prev: GState, index: number, mark: Mark): GState {
  if (prev.board[index] || prev.tttResult) return prev;
  const board = prev.board.slice();
  board[index] = mark;
  return { ...prev, board, tttResult: tttWinner(board), turn: mark === "X" ? "O" : "X" };
}

// Drops a disc into a column: it lands on the lowest empty row.
function applyC4Drop(prev: GState, col: number, disc: Disc): GState {
  if (prev.c4Result) return prev;
  const board = prev.c4board.slice();
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    const i = r * C4_COLS + col;
    if (!board[i]) {
      board[i] = disc;
      return {
        ...prev,
        c4board: board,
        c4Result: c4Winner(board),
        c4Turn: disc === "R" ? "Y" : "R",
      };
    }
  }
  return prev; // column full
}

// Scores a Rock-Paper-Scissors round once both throws are in (guarded so it
// only counts a single time per round, on whichever client sees both first).
function settleRps(p: GState): GState {
  if (p.myThrow && p.theirThrow && !p.scored) {
    const o = rpsOutcome(p.myThrow, p.theirThrow);
    return {
      ...p,
      scored: true,
      myScore: p.myScore + (o === "win" ? 1 : 0),
      theirScore: p.theirScore + (o === "lose" ? 1 : 0),
    };
  }
  return p;
}

export interface CoupleGame {
  phase: Phase;
  game: GameId | null;
  board: Cell[];
  myMark: Mark | null;
  turn: Mark;
  tttResult: Mark | "draw" | null;
  myThrow: Throw | null;
  theirThrow: Throw | null;
  myScore: number;
  theirScore: number;
  c4board: (Disc | null)[];
  c4Disc: Disc | null;
  c4Turn: Disc;
  c4Result: Disc | "draw" | null;
  declined: boolean;
  open: () => void;
  choose: (game: GameId) => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  play: (index: number) => void;
  throwRps: (choice: Throw) => void;
  dropC4: (col: number) => void;
  nextRound: () => void;
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

  const send = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      channelRef.current?.send({ type: "broadcast", event, payload: { from: meId, ...payload } });
    },
    [meId]
  );

  useEffect(() => {
    const channel = supabase.channel(`game:${coupleId}`);

    channel
      .on("broadcast", { event: "invite" }, ({ payload }) => {
        const game = payload?.game as GameId;
        if (stateRef.current.phase === "idle" && (game === "ttt" || game === "rps")) {
          setState(makeState("invited", game, "guest"));
        }
      })
      .on("broadcast", { event: "cancel" }, () => {
        if (stateRef.current.phase === "invited") setState(FRESH());
      })
      .on("broadcast", { event: "accept" }, () => {
        // My invite was accepted → I'm the host.
        const s = stateRef.current;
        if (s.phase === "inviting" && s.game) setState(makeState("playing", s.game, "host"));
      })
      .on("broadcast", { event: "decline" }, () => {
        if (stateRef.current.phase === "inviting") {
          setState({ ...FRESH(), declined: true });
          setTimeout(() => setState((p) => (p.declined ? FRESH() : p)), 2600);
        }
      })
      .on("broadcast", { event: "ttt_move" }, ({ payload }) => {
        const index = payload?.index as number;
        const mark = payload?.mark as Mark;
        if (typeof index !== "number" || (mark !== "X" && mark !== "O")) return;
        setState((p) => (p.phase === "playing" && p.game === "ttt" ? applyTttMove(p, index, mark) : p));
      })
      .on("broadcast", { event: "rps_throw" }, ({ payload }) => {
        const t = payload?.throw as Throw;
        if (t !== "rock" && t !== "paper" && t !== "scissors") return;
        setState((p) => (p.game === "rps" ? settleRps({ ...p, theirThrow: t }) : p));
      })
      .on("broadcast", { event: "c4_move" }, ({ payload }) => {
        const col = payload?.col as number;
        const disc = payload?.disc as Disc;
        if (typeof col !== "number" || (disc !== "R" && disc !== "Y")) return;
        setState((p) => (p.phase === "playing" && p.game === "c4" ? applyC4Drop(p, col, disc) : p));
      })
      .on("broadcast", { event: "rps_next" }, () => {
        setState((p) =>
          p.game === "rps"
            ? { ...p, myThrow: null, theirThrow: null, scored: false }
            : p
        );
      })
      .on("broadcast", { event: "rematch" }, () => {
        setState((p) =>
          p.game === "ttt" || p.game === "c4"
            ? makeState("playing", p.game, roleOf(p))
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

  const open = useCallback(() => setState({ ...FRESH(), phase: "picking" }), []);

  const choose = useCallback(
    (game: GameId) => {
      setState(makeState("inviting", game, "host"));
      send("invite", { game });
    },
    [send]
  );

  const cancel = useCallback(() => {
    const s = stateRef.current;
    setState(FRESH());
    if (s.phase === "inviting") send("cancel");
  }, [send]);

  const accept = useCallback(() => {
    const s = stateRef.current;
    if (!s.game) return;
    setState(makeState("playing", s.game, "guest"));
    send("accept");
  }, [send]);

  const decline = useCallback(() => {
    setState(FRESH());
    send("decline");
  }, [send]);

  const play = useCallback(
    (index: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "ttt" || s.tttResult || s.myMark !== s.turn || s.board[index])
        return;
      const mark = s.myMark;
      setState((p) => applyTttMove(p, index, mark));
      send("ttt_move", { index, mark });
    },
    [send]
  );

  const throwRps = useCallback(
    (choice: Throw) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "rps" || s.myThrow) return;
      setState((p) => settleRps({ ...p, myThrow: choice }));
      send("rps_throw", { throw: choice });
    },
    [send]
  );

  const dropC4 = useCallback(
    (col: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "c4" || s.c4Result || s.c4Disc !== s.c4Turn) return;
      // Ignore taps on a full column.
      if (s.c4board[col]) return;
      const disc = s.c4Disc;
      setState((p) => applyC4Drop(p, col, disc));
      send("c4_move", { col, disc });
    },
    [send]
  );

  const nextRound = useCallback(() => {
    setState((p) => (p.game === "rps" ? { ...p, myThrow: null, theirThrow: null, scored: false } : p));
    send("rps_next");
  }, [send]);

  const rematch = useCallback(() => {
    setState((p) =>
      p.game === "ttt" || p.game === "c4" ? makeState("playing", p.game, roleOf(p)) : p
    );
    send("rematch");
  }, [send]);

  const close = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "playing" || s.phase === "inviting" || s.phase === "invited") send("quit");
    setState(FRESH());
  }, [send]);

  return {
    phase: state.phase,
    game: state.game,
    board: state.board,
    myMark: state.myMark,
    turn: state.turn,
    tttResult: state.tttResult,
    myThrow: state.myThrow,
    theirThrow: state.theirThrow,
    myScore: state.myScore,
    theirScore: state.theirScore,
    c4board: state.c4board,
    c4Disc: state.c4Disc,
    c4Turn: state.c4Turn,
    c4Result: state.c4Result,
    declined: state.declined,
    open,
    choose,
    cancel,
    accept,
    decline,
    play,
    throwRps,
    dropC4,
    nextRound,
    rematch,
    close,
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export default function GameModal({
  game,
  partnerName,
}: {
  game: CoupleGame;
  partnerName: string;
}) {
  const { phase, declined } = game;
  if (phase === "idle" && !declined) return null;

  const meta = game.game ? GAMES.find((g) => g.id === game.game) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl border border-neutral-200 bg-white p-6 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        {declined && phase === "idle" && (
          <p className="text-center text-sm text-neutral-500">
            {partnerName} isn’t up for a game right now 💤
          </p>
        )}

        {phase === "picking" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Pick a game 🎮
              </p>
              <button onClick={game.cancel} className="text-sm text-neutral-400">
                Cancel
              </button>
            </div>
            <div className="space-y-2">
              {GAMES.map((g) => (
                <button
                  key={g.id}
                  onClick={() => game.choose(g.id)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-neutral-100 p-3 text-left active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
                >
                  <span className="text-2xl">{g.emoji}</span>
                  <span>
                    <span className="block font-semibold text-neutral-900 dark:text-neutral-100">
                      {g.name}
                    </span>
                    <span className="block text-xs text-neutral-500">{g.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "inviting" && (
          <Centered title={meta?.name ?? "Game"} subtitle={`Waiting for ${partnerName} to join…`}>
            <div className="my-4 flex justify-center">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-fuchsia-500 border-t-transparent" />
            </div>
            <Btn variant="ghost" onClick={game.cancel}>Cancel</Btn>
          </Centered>
        )}

        {phase === "invited" && (
          <Centered
            title={`${meta?.emoji ?? "🎮"} Game invite`}
            subtitle={`${partnerName} wants to play ${meta?.name ?? "a game"}`}
          >
            <div className="mt-5 flex gap-3">
              <Btn variant="ghost" onClick={game.decline}>Not now</Btn>
              <Btn variant="primary" onClick={game.accept}>Let’s play</Btn>
            </div>
          </Centered>
        )}

        {phase === "playing" && game.game === "ttt" && (
          <TttBoard game={game} partnerName={partnerName} />
        )}
        {phase === "playing" && game.game === "c4" && (
          <C4Board game={game} partnerName={partnerName} />
        )}
        {phase === "playing" && game.game === "rps" && (
          <RpsBoard game={game} partnerName={partnerName} />
        )}
      </div>
    </div>
  );
}

function TttBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { board, myMark, turn, tttResult } = game;
  const myTurn = !tttResult && turn === myMark;

  let status: string;
  let tone = "text-neutral-500";
  if (tttResult === "draw") {
    status = "It’s a draw 🤝";
  } else if (tttResult) {
    const iWon = tttResult === myMark;
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
            className={`grid place-items-center rounded-2xl text-4xl font-bold transition active:scale-95
              ${cell === "X" ? "text-fuchsia-500" : "text-violet-500"}
              ${
                !cell && myTurn
                  ? "bg-neutral-100 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
                  : "bg-neutral-100 dark:bg-neutral-800"
              }`}
          >
            {cell}
          </button>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {tttResult && <Btn variant="primary" onClick={game.rematch}>Play again</Btn>}
      </div>
    </div>
  );
}

function C4Board({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { c4board, c4Disc, c4Turn, c4Result } = game;
  const myTurn = !c4Result && c4Turn === c4Disc;
  const myColorName = c4Disc === "R" ? "Red" : "Yellow";

  let status: string;
  let tone = "text-neutral-500";
  if (c4Result === "draw") {
    status = "It’s a draw 🤝";
  } else if (c4Result) {
    const iWon = c4Result === c4Disc;
    status = iWon ? "You win! 🎉" : `${partnerName} wins 😄`;
    tone = iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (myTurn) {
    status = "Your turn — tap a column";
    tone = "text-emerald-500";
  } else {
    status = `${partnerName}’s turn…`;
  }

  const discColor = (d: Disc | null) =>
    d === "R" ? "bg-red-500" : d === "Y" ? "bg-yellow-400" : "bg-white dark:bg-neutral-900";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Connect Four</p>
        <p className="text-xs text-neutral-400">
          You are{" "}
          <span className={c4Disc === "R" ? "text-red-500" : "text-yellow-500"}>{myColorName}</span>
        </p>
      </div>
      <p className={`mb-3 text-sm font-medium ${tone}`}>{status}</p>

      <div className="mx-auto grid grid-cols-7 gap-1 rounded-2xl bg-blue-600 p-1.5">
        {Array.from({ length: C4_COLS }).map((_, col) => {
          const colFull = Boolean(c4board[col]);
          return (
            <button
              key={col}
              type="button"
              onClick={() => game.dropC4(col)}
              disabled={!myTurn || colFull}
              aria-label={`Drop in column ${col + 1}`}
              className="flex flex-col gap-1 rounded-md p-0 transition active:scale-95 disabled:active:scale-100"
            >
              {Array.from({ length: C4_ROWS }).map((__, row) => (
                <span
                  key={row}
                  className={`block aspect-square w-full rounded-full ${discColor(
                    c4board[row * C4_COLS + col]
                  )}`}
                />
              ))}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {c4Result && <Btn variant="primary" onClick={game.rematch}>Play again</Btn>}
      </div>
    </div>
  );
}

const THROW_EMOJI: Record<Throw, string> = { rock: "✊", paper: "✋", scissors: "✌️" };
const THROWS: Throw[] = ["rock", "paper", "scissors"];

function RpsBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { myThrow, theirThrow, myScore, theirScore } = game;
  const revealed = Boolean(myThrow && theirThrow);
  const outcome = revealed ? rpsOutcome(myThrow!, theirThrow!) : null;

  let status = "Make your move 👇";
  let tone = "text-neutral-500";
  if (outcome === "win") { status = "You win this round! 🎉"; tone = "text-emerald-500"; }
  else if (outcome === "lose") { status = `${partnerName} wins this round 😄`; tone = "text-fuchsia-500"; }
  else if (outcome === "draw") { status = "Tie! Go again 🤝"; }
  else if (myThrow) { status = `Waiting for ${partnerName}…`; }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Rock Paper Scissors</p>
        <p className="text-xs text-neutral-400">You {myScore} – {theirScore} {partnerName.split(" ")[0]}</p>
      </div>

      <div className="mb-4 flex items-center justify-center gap-6 py-2 text-5xl">
        <span>{myThrow ? (revealed ? THROW_EMOJI[myThrow] : "🤫") : "❔"}</span>
        <span className="text-base text-neutral-400">vs</span>
        <span>{revealed ? THROW_EMOJI[theirThrow!] : theirThrow ? "✅" : "❔"}</span>
      </div>

      <p className={`mb-4 text-center text-sm font-medium ${tone}`}>{status}</p>

      {!myThrow ? (
        <div className="flex justify-center gap-3">
          {THROWS.map((t) => (
            <button
              key={t}
              onClick={() => game.throwRps(t)}
              className="grid h-16 w-16 place-items-center rounded-2xl bg-neutral-100 text-3xl transition active:scale-95 active:bg-neutral-200 dark:bg-neutral-800 dark:active:bg-neutral-700"
              aria-label={t}
            >
              {THROW_EMOJI[t]}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-3">
          <Btn variant="ghost" onClick={game.close}>Close</Btn>
          {revealed && <Btn variant="primary" onClick={game.nextRound}>Next round</Btn>}
        </div>
      )}
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
      className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition active:scale-95 ${
        variant === "primary"
          ? "bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white"
          : "bg-neutral-100 text-neutral-700 active:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:active:bg-neutral-700"
      }`}
    >
      {children}
    </button>
  );
}
