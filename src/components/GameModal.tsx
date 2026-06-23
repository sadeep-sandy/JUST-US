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

export type GameId = "ttt" | "rps" | "c4" | "db" | "mem";

export const GAMES: { id: GameId; name: string; emoji: string; blurb: string }[] = [
  { id: "ttt", name: "Tic-Tac-Toe", emoji: "⭕", blurb: "Classic 3-in-a-row" },
  { id: "c4", name: "Connect Four", emoji: "🔴", blurb: "Drop 4 in a row" },
  { id: "db", name: "Dots & Boxes", emoji: "🔳", blurb: "Close boxes to score" },
  { id: "mem", name: "Memory Match", emoji: "🧠", blurb: "Find the pairs" },
  { id: "rps", name: "Rock Paper Scissors", emoji: "✊", blurb: "Quick best-of throws" },
];

type Phase = "idle" | "picking" | "inviting" | "invited" | "playing";
type Mark = "X" | "O";
type Cell = Mark | null;
type Throw = "rock" | "paper" | "scissors";
type Disc = "R" | "Y"; // Connect Four: Red (host, first) vs Yellow (guest)
type Seat = "A" | "B"; // Generic two-player seats (host = A, moves first)

const C4_COLS = 7;
const C4_ROWS = 6;

// Dots & Boxes: a grid of dots with edges between them; closing a box scores it.
const DB_DOTS = 4; // 4×4 dots → 3×3 boxes
const DB_BOXES = DB_DOTS - 1;
const dbHIndex = (r: number, c: number) => r * DB_BOXES + c; // r:0..DB_DOTS-1
const dbVIndex = (r: number, c: number) => r * DB_DOTS + c; //  r:0..DB_BOXES-1

// Memory Match: pairs of emoji cards laid out from a shared seed.
const MEM_PAIRS = 6;
const MEM_FACES = ["🐶", "🐱", "🦊", "🐼", "🦁", "🐸", "🐵", "🐰", "🐯", "🐨"];

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

// Dots & Boxes: is the box at (br,bc) closed on all four sides?
function dbBoxClosed(h: boolean[], v: boolean[], br: number, bc: number): boolean {
  return (
    h[dbHIndex(br, bc)] &&
    h[dbHIndex(br + 1, bc)] &&
    v[dbVIndex(br, bc)] &&
    v[dbVIndex(br, bc + 1)]
  );
}

// Memory Match: deterministic shuffle from a seed so both phones see the same
// board without sending the whole layout.
function memDeck(seed: number): string[] {
  const faces = MEM_FACES.slice(0, MEM_PAIRS);
  const cards = [...faces, ...faces];
  let s = seed || 1;
  const rng = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
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
  // dots & boxes
  dbH: boolean[];
  dbV: boolean[];
  dbBoxes: (Seat | null)[];
  dbSeat: Seat | null;
  dbTurn: Seat;
  // memory match
  memSeed: number;
  memOwner: (Seat | null)[];
  memFlipped: number[];
  memSeat: Seat | null;
  memTurn: Seat;
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
  dbH: Array(DB_DOTS * DB_BOXES).fill(false),
  dbV: Array(DB_BOXES * DB_DOTS).fill(false),
  dbBoxes: Array(DB_BOXES * DB_BOXES).fill(null),
  dbSeat: null,
  dbTurn: "A",
  memSeed: 0,
  memOwner: Array(MEM_PAIRS * 2).fill(null),
  memFlipped: [],
  memSeat: null,
  memTurn: "A",
  declined: false,
});

// Builds a fresh per-game state for a given phase. `role` decides who plays
// first: Tic-Tac-Toe host = X, Connect Four host = R (Red).
function makeState(phase: Phase, game: GameId, role: "host" | "guest"): GState {
  const base = { ...FRESH(), phase, game };
  if (game === "ttt") return { ...base, myMark: role === "host" ? "X" : "O", turn: "X" };
  if (game === "c4") return { ...base, c4Disc: role === "host" ? "R" : "Y", c4Turn: "R" };
  if (game === "db") return { ...base, dbSeat: role === "host" ? "A" : "B", dbTurn: "A" };
  if (game === "mem") return { ...base, memSeat: role === "host" ? "A" : "B", memTurn: "A" };
  return base;
}

// Derives host/guest from the player's assigned colour/mark, so a rematch keeps
// the same sides.
function roleOf(p: GState): "host" | "guest" {
  if (p.game === "c4") return p.c4Disc === "R" ? "host" : "guest";
  if (p.game === "db") return p.dbSeat === "A" ? "host" : "guest";
  if (p.game === "mem") return p.memSeat === "A" ? "host" : "guest";
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

// Dots & Boxes: set an edge; if it closes one or two boxes the same player goes
// again, otherwise the turn passes.
function applyDbMove(prev: GState, kind: "h" | "v", idx: number): GState {
  const h = prev.dbH.slice();
  const v = prev.dbV.slice();
  if (kind === "h") {
    if (h[idx]) return prev;
    h[idx] = true;
  } else {
    if (v[idx]) return prev;
    v[idx] = true;
  }
  const boxes = prev.dbBoxes.slice();
  let gained = 0;
  for (let br = 0; br < DB_BOXES; br++) {
    for (let bc = 0; bc < DB_BOXES; bc++) {
      const bi = br * DB_BOXES + bc;
      if (!boxes[bi] && dbBoxClosed(h, v, br, bc)) {
        boxes[bi] = prev.dbTurn;
        gained++;
      }
    }
  }
  const turn: Seat = gained > 0 ? prev.dbTurn : prev.dbTurn === "A" ? "B" : "A";
  return { ...prev, dbH: h, dbV: v, dbBoxes: boxes, dbTurn: turn };
}

// Memory Match: reveal a card (max two face-up at once).
function applyMemFlip(prev: GState, i: number): GState {
  if (prev.game !== "mem") return prev;
  if (prev.memOwner[i] || prev.memFlipped.includes(i) || prev.memFlipped.length >= 2) {
    return prev;
  }
  return { ...prev, memFlipped: [...prev.memFlipped, i] };
}

// Memory Match: resolve the two face-up cards (deterministic, so both phones
// reach the same result without extra signalling).
function applyMemResolve(prev: GState): GState {
  if (prev.game !== "mem" || prev.memFlipped.length !== 2) return prev;
  const deck = memDeck(prev.memSeed);
  const [a, b] = prev.memFlipped;
  if (deck[a] === deck[b]) {
    const owner = prev.memOwner.slice();
    owner[a] = prev.memTurn;
    owner[b] = prev.memTurn;
    return { ...prev, memOwner: owner, memFlipped: [] }; // matcher goes again
  }
  return { ...prev, memFlipped: [], memTurn: prev.memTurn === "A" ? "B" : "A" };
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
  dbH: boolean[];
  dbV: boolean[];
  dbBoxes: (Seat | null)[];
  dbSeat: Seat | null;
  dbTurn: Seat;
  memSeed: number;
  memOwner: (Seat | null)[];
  memFlipped: number[];
  memSeat: Seat | null;
  memTurn: Seat;
  declined: boolean;
  open: () => void;
  choose: (game: GameId) => void;
  cancel: () => void;
  accept: () => void;
  decline: () => void;
  play: (index: number) => void;
  throwRps: (choice: Throw) => void;
  dropC4: (col: number) => void;
  tapDbEdge: (kind: "h" | "v", idx: number) => void;
  flipMem: (i: number) => void;
  resolveMem: () => void;
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
        if (stateRef.current.phase !== "idle") return;
        if (!GAMES.some((g) => g.id === game)) return;
        let s = makeState("invited", game, "guest");
        if (game === "mem") s = { ...s, memSeed: (payload?.seed as number) || 1 };
        setState(s);
      })
      .on("broadcast", { event: "cancel" }, () => {
        if (stateRef.current.phase === "invited") setState(FRESH());
      })
      .on("broadcast", { event: "accept" }, () => {
        // My invite was accepted → I'm the host. Keep the shared memory seed.
        const s = stateRef.current;
        if (s.phase === "inviting" && s.game) {
          let ns = makeState("playing", s.game, "host");
          if (s.game === "mem") ns = { ...ns, memSeed: s.memSeed };
          setState(ns);
        }
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
      .on("broadcast", { event: "db_move" }, ({ payload }) => {
        const kind = payload?.kind as "h" | "v";
        const idx = payload?.idx as number;
        if ((kind !== "h" && kind !== "v") || typeof idx !== "number") return;
        setState((p) => (p.phase === "playing" && p.game === "db" ? applyDbMove(p, kind, idx) : p));
      })
      .on("broadcast", { event: "mem_flip" }, ({ payload }) => {
        const i = payload?.i as number;
        if (typeof i !== "number") return;
        setState((p) => (p.phase === "playing" && p.game === "mem" ? applyMemFlip(p, i) : p));
      })
      .on("broadcast", { event: "rps_next" }, () => {
        setState((p) =>
          p.game === "rps"
            ? { ...p, myThrow: null, theirThrow: null, scored: false }
            : p
        );
      })
      .on("broadcast", { event: "rematch" }, ({ payload }) => {
        setState((p) => {
          if (p.game === "ttt" || p.game === "c4" || p.game === "db") {
            return makeState("playing", p.game, roleOf(p));
          }
          if (p.game === "mem") {
            return {
              ...makeState("playing", "mem", roleOf(p)),
              memSeed: (payload?.seed as number) || p.memSeed,
            };
          }
          return p;
        });
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
      let s = makeState("inviting", game, "host");
      let seed: number | undefined;
      if (game === "mem") {
        seed = Math.floor(Math.random() * 1e9) + 1;
        s = { ...s, memSeed: seed };
      }
      setState(s);
      send("invite", { game, seed });
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
    let ns = makeState("playing", s.game, "guest");
    if (s.game === "mem") ns = { ...ns, memSeed: s.memSeed };
    setState(ns);
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

  const tapDbEdge = useCallback(
    (kind: "h" | "v", idx: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "db" || s.dbSeat !== s.dbTurn) return;
      if (s.dbBoxes.every(Boolean)) return;
      if (kind === "h" ? s.dbH[idx] : s.dbV[idx]) return;
      setState((p) => applyDbMove(p, kind, idx));
      send("db_move", { kind, idx });
    },
    [send]
  );

  const flipMem = useCallback(
    (i: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "mem" || s.memSeat !== s.memTurn) return;
      if (s.memFlipped.length >= 2 || s.memOwner[i] || s.memFlipped.includes(i)) return;
      setState((p) => applyMemFlip(p, i));
      send("mem_flip", { i });
    },
    [send]
  );

  // Both phones run this on a timer once two cards are up; it's deterministic so
  // no extra signalling is needed.
  const resolveMem = useCallback(() => {
    setState((p) => applyMemResolve(p));
  }, []);

  const nextRound = useCallback(() => {
    setState((p) => (p.game === "rps" ? { ...p, myThrow: null, theirThrow: null, scored: false } : p));
    send("rps_next");
  }, [send]);

  const rematch = useCallback(() => {
    const p = stateRef.current;
    if (p.game === "mem") {
      const seed = Math.floor(Math.random() * 1e9) + 1;
      setState({ ...makeState("playing", "mem", roleOf(p)), memSeed: seed });
      send("rematch", { seed });
      return;
    }
    if (p.game === "ttt" || p.game === "c4" || p.game === "db") {
      setState(makeState("playing", p.game, roleOf(p)));
      send("rematch");
    }
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
    dbH: state.dbH,
    dbV: state.dbV,
    dbBoxes: state.dbBoxes,
    dbSeat: state.dbSeat,
    dbTurn: state.dbTurn,
    memSeed: state.memSeed,
    memOwner: state.memOwner,
    memFlipped: state.memFlipped,
    memSeat: state.memSeat,
    memTurn: state.memTurn,
    declined: state.declined,
    open,
    choose,
    cancel,
    accept,
    decline,
    play,
    throwRps,
    dropC4,
    tapDbEdge,
    flipMem,
    resolveMem,
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
        {phase === "playing" && game.game === "db" && (
          <DbBoard game={game} partnerName={partnerName} />
        )}
        {phase === "playing" && game.game === "mem" && (
          <MemBoard game={game} partnerName={partnerName} />
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

function DbBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { dbH, dbV, dbBoxes, dbSeat, dbTurn } = game;
  const done = dbBoxes.every(Boolean);
  const myTurn = !done && dbSeat === dbTurn;
  const aScore = dbBoxes.filter((b) => b === "A").length;
  const bScore = dbBoxes.filter((b) => b === "B").length;
  const myScore = dbSeat === "A" ? aScore : bScore;
  const theirScore = dbSeat === "A" ? bScore : aScore;

  let status: string;
  let tone = "text-neutral-500";
  if (done) {
    const tie = myScore === theirScore;
    const iWon = myScore > theirScore;
    status = tie ? "It’s a tie 🤝" : iWon ? "You win! 🎉" : `${partnerName} wins 😄`;
    tone = tie ? "text-neutral-500" : iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (myTurn) {
    status = "Your turn — draw a line";
    tone = "text-emerald-500";
  } else {
    status = `${partnerName}’s turn…`;
  }

  const dim = 2 * DB_DOTS - 1;
  const track = ["14px", ...Array(DB_BOXES).fill("34px 14px")].join(" ");
  const boxColor = (s: Seat | null) =>
    s === dbSeat
      ? "bg-fuchsia-300/70 dark:bg-fuchsia-500/40"
      : s
        ? "bg-violet-300/70 dark:bg-violet-500/40"
        : "";
  const onColor = "bg-neutral-800 dark:bg-neutral-200";
  const offColor = myTurn
    ? "bg-neutral-300 active:bg-neutral-400 dark:bg-neutral-600"
    : "bg-neutral-200 dark:bg-neutral-700";

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < dim; row++) {
    for (let col = 0; col < dim; col++) {
      const er = row % 2 === 0;
      const ec = col % 2 === 0;
      const key = `${row}-${col}`;
      if (er && ec) {
        cells.push(<span key={key} className="h-3.5 w-3.5 rounded-full bg-neutral-500" />);
      } else if (er && !ec) {
        const idx = dbHIndex(row / 2, (col - 1) / 2);
        const on = dbH[idx];
        cells.push(
          <button
            key={key}
            type="button"
            disabled={!myTurn || on}
            onClick={() => game.tapDbEdge("h", idx)}
            aria-label="Draw horizontal line"
            className="flex items-center justify-center"
          >
            <span className={`h-1 w-full rounded-full ${on ? onColor : offColor}`} />
          </button>
        );
      } else if (!er && ec) {
        const idx = dbVIndex((row - 1) / 2, col / 2);
        const on = dbV[idx];
        cells.push(
          <button
            key={key}
            type="button"
            disabled={!myTurn || on}
            onClick={() => game.tapDbEdge("v", idx)}
            aria-label="Draw vertical line"
            className="flex items-center justify-center"
          >
            <span className={`h-full w-1 rounded-full ${on ? onColor : offColor}`} />
          </button>
        );
      } else {
        const owner = dbBoxes[((row - 1) / 2) * DB_BOXES + (col - 1) / 2];
        cells.push(<span key={key} className={`h-full w-full rounded-sm ${boxColor(owner)}`} />);
      }
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Dots &amp; Boxes</p>
        <p className="text-xs text-neutral-400">
          You {myScore} – {theirScore} {partnerName.split(" ")[0]}
        </p>
      </div>
      <p className={`mb-4 text-sm font-medium ${tone}`}>{status}</p>

      <div
        className="mx-auto w-fit"
        style={{ display: "grid", gridTemplateColumns: track, gridTemplateRows: track }}
      >
        {cells}
      </div>

      <div className="mt-6 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {done && <Btn variant="primary" onClick={game.rematch}>Play again</Btn>}
      </div>
    </div>
  );
}

function MemBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { memSeed, memOwner, memFlipped, memSeat, memTurn } = game;
  const deck = memDeck(memSeed);
  const done = memOwner.every(Boolean);
  const myTurn = !done && memSeat === memTurn && memFlipped.length < 2;
  const aPairs = memOwner.filter((o) => o === "A").length / 2;
  const bPairs = memOwner.filter((o) => o === "B").length / 2;
  const myPairs = memSeat === "A" ? aPairs : bPairs;
  const theirPairs = memSeat === "A" ? bPairs : aPairs;

  // Once two cards are face-up, both phones resolve on a short timer.
  const flippedKey = memFlipped.join(",");
  useEffect(() => {
    if (memFlipped.length !== 2) return;
    const t = setTimeout(() => game.resolveMem(), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flippedKey]);

  let status: string;
  let tone = "text-neutral-500";
  if (done) {
    const tie = myPairs === theirPairs;
    const iWon = myPairs > theirPairs;
    status = tie ? "It’s a tie 🤝" : iWon ? "You win! 🎉" : `${partnerName} wins 😄`;
    tone = tie ? "text-neutral-500" : iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (memFlipped.length === 2) {
    status = "…";
  } else if (memSeat === memTurn) {
    status = "Your turn — flip a card";
    tone = "text-emerald-500";
  } else {
    status = `${partnerName}’s turn…`;
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Memory Match</p>
        <p className="text-xs text-neutral-400">
          You {myPairs} – {theirPairs} {partnerName.split(" ")[0]}
        </p>
      </div>
      <p className={`mb-3 text-sm font-medium ${tone}`}>{status}</p>

      <div className="mx-auto grid max-w-[280px] grid-cols-4 gap-2">
        {deck.map((face, i) => {
          const owner = memOwner[i];
          const faceUp = Boolean(owner) || memFlipped.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={!myTurn || faceUp}
              onClick={() => game.flipMem(i)}
              aria-label={faceUp ? face : "Hidden card"}
              className={`grid aspect-square place-items-center rounded-xl text-2xl transition active:scale-95 ${
                faceUp
                  ? owner
                    ? "bg-emerald-100 dark:bg-emerald-500/20"
                    : "bg-neutral-100 dark:bg-neutral-800"
                  : "bg-gradient-to-br from-fuchsia-500 to-violet-500"
              }`}
            >
              {faceUp ? face : ""}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {done && <Btn variant="primary" onClick={game.rematch}>Play again</Btn>}
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
