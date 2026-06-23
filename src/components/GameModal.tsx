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

export type GameId = "ttt" | "rps" | "c4" | "db" | "mem" | "ck" | "bs" | "lu";

export const GAMES: { id: GameId; name: string; emoji: string; blurb: string }[] = [
  { id: "lu", name: "Ludo", emoji: "🎲", blurb: "Race your tokens home" },
  { id: "ttt", name: "Tic-Tac-Toe", emoji: "⭕", blurb: "Classic 3-in-a-row" },
  { id: "c4", name: "Connect Four", emoji: "🔴", blurb: "Drop 4 in a row" },
  { id: "ck", name: "Checkers", emoji: "♟️", blurb: "Jump and crown kings" },
  { id: "bs", name: "Battleship", emoji: "🚢", blurb: "Sink the hidden fleet" },
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

// Checkers: 8×8 board, dark squares only. a/A = seat A man/king, b/B = seat B.
const CK_N = 8;
type CkPiece = "" | "a" | "A" | "b" | "B";

// Battleship: each player hides a fleet on their own secret grid.
const BS_N = 6;
const BS_SHIPS = [3, 2, 2];

// Ludo (2-player): a 52-cell loop drawn on the perimeter of a 14×14 ring, then
// a 6-cell home stretch. Token progress: -1 = base, 0..50 = loop, 51..55 = home
// column, 56 = finished. Seat A enters at loop cell 0, seat B opposite at 26.
const LU_A_START = 0;
const LU_B_START = 26;
const LU_SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // starts + star squares
const luStart = (s: Seat) => (s === "A" ? LU_A_START : LU_B_START);

// The 52-cell main loop as [row, col] on a 15×15 Ludo board, clockwise from the
// red start. Seat A (red, top-left) enters at index 0; seat B (yellow,
// bottom-right) at index 26 — diagonally opposite, the classic 2-player setup.
const LU_PATH: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];
const LU_BASE_SLOTS: Record<Seat, [number, number][]> = {
  A: [[1, 1], [1, 4], [4, 1], [4, 4]], // red base, top-left
  B: [[10, 10], [10, 13], [13, 10], [13, 13]], // yellow base, bottom-right
};
// Board cell [row, col] for a token: base slot, loop cell, home column, or home.
function luTokenCell(owner: Seat, p: number, slot: number): [number, number] {
  if (p === -1) return LU_BASE_SLOTS[owner][slot];
  if (p <= 50) return LU_PATH[(luStart(owner) + p) % 52];
  if (p <= 55) return owner === "A" ? [7, p - 50] : [7, 14 - (p - 50)];
  return owner === "A" ? [7, 6] : [7, 8]; // home
}

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

// ---- Checkers helpers ----
function ckInitBoard(): CkPiece[] {
  const b: CkPiece[] = Array(CK_N * CK_N).fill("");
  for (let r = 0; r < CK_N; r++) {
    for (let c = 0; c < CK_N; c++) {
      if ((r + c) % 2 === 1) {
        if (r < 3) b[r * CK_N + c] = "b"; // seat B at the top
        else if (r > 4) b[r * CK_N + c] = "a"; // seat A at the bottom
      }
    }
  }
  return b;
}
const ckOwner = (p: CkPiece): Seat | null =>
  p === "a" || p === "A" ? "A" : p === "b" || p === "B" ? "B" : null;
const ckKing = (p: CkPiece) => p === "A" || p === "B";
function ckDirs(p: CkPiece): number[][] {
  if (ckKing(p)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return ckOwner(p) === "A" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}
const ckIn = (r: number, c: number) => r >= 0 && r < CK_N && c >= 0 && c < CK_N;

// Legal destinations for one piece; if it can jump, only jumps are returned.
function ckMoves(b: CkPiece[], idx: number): { to: number; cap: number | null }[] {
  const p = b[idx];
  const owner = ckOwner(p);
  if (!owner) return [];
  const r = Math.floor(idx / CK_N);
  const c = idx % CK_N;
  const steps: { to: number; cap: number | null }[] = [];
  const jumps: { to: number; cap: number | null }[] = [];
  for (const [dr, dc] of ckDirs(p)) {
    const r1 = r + dr;
    const c1 = c + dc;
    if (!ckIn(r1, c1)) continue;
    const i1 = r1 * CK_N + c1;
    if (b[i1] === "") {
      steps.push({ to: i1, cap: null });
    } else if (ckOwner(b[i1]) && ckOwner(b[i1]) !== owner) {
      const r2 = r + 2 * dr;
      const c2 = c + 2 * dc;
      if (ckIn(r2, c2) && b[r2 * CK_N + c2] === "") {
        jumps.push({ to: r2 * CK_N + c2, cap: i1 });
      }
    }
  }
  return jumps.length ? jumps : steps;
}

function applyCkMove(prev: GState, from: number, to: number): GState {
  if (prev.ckResult) return prev;
  const b = prev.ckBoard.slice();
  const p = b[from];
  if (ckOwner(p) !== prev.ckTurn) return prev;
  if (prev.ckMust !== null && prev.ckMust !== from) return prev;
  const mv = ckMoves(b, from).find((m) => m.to === to);
  if (!mv) return prev;
  b[to] = p;
  b[from] = "";
  if (mv.cap !== null) b[mv.cap] = "";
  // Promote on reaching the far row.
  const r2 = Math.floor(to / CK_N);
  if (b[to] === "a" && r2 === 0) b[to] = "A";
  if (b[to] === "b" && r2 === CK_N - 1) b[to] = "B";

  let must: number | null = null;
  let turn = prev.ckTurn;
  if (mv.cap !== null && ckMoves(b, to).some((m) => m.cap !== null)) {
    must = to; // same piece must keep jumping
  } else {
    turn = prev.ckTurn === "A" ? "B" : "A";
  }

  let result: Seat | null = null;
  if (must === null) {
    const oppHasPieces = b.some((x) => ckOwner(x) === turn);
    const oppHasMoves = b.some((x, i) => ckOwner(x) === turn && ckMoves(b, i).length > 0);
    if (!oppHasPieces || !oppHasMoves) result = prev.ckTurn;
  }
  return { ...prev, ckBoard: b, ckTurn: turn, ckMust: must, ckResult: result };
}

// ---- Battleship helpers ----
function bsRandomBoard(): number[] {
  const b = Array(BS_N * BS_N).fill(0);
  let id = 1;
  for (const len of BS_SHIPS) {
    for (let tries = 0; tries < 300; tries++) {
      const horiz = Math.random() < 0.5;
      const r = Math.floor(Math.random() * BS_N);
      const c = Math.floor(Math.random() * BS_N);
      const cells: number[] = [];
      let ok = true;
      for (let k = 0; k < len; k++) {
        const rr = horiz ? r : r + k;
        const cc = horiz ? c + k : c;
        if (rr >= BS_N || cc >= BS_N || b[rr * BS_N + cc] !== 0) {
          ok = false;
          break;
        }
        cells.push(rr * BS_N + cc);
      }
      if (ok) {
        cells.forEach((i) => (b[i] = id));
        break;
      }
    }
    id++;
  }
  return b;
}
const bsAllSunk = (board: number[], incoming: boolean[]) =>
  board.every((v, i) => v === 0 || incoming[i]);

// ---- Ludo helpers ----
function luMovable(tokens: number[], seat: Seat, die: number): number[] {
  const base = seat === "A" ? 0 : 4;
  const res: number[] = [];
  for (let t = base; t < base + 4; t++) {
    const p = tokens[t];
    if (p === 56) continue;
    if (p === -1) {
      if (die === 6) res.push(t);
    } else if (p + die <= 56) {
      res.push(t);
    }
  }
  return res;
}

function applyLuRoll(prev: GState, v: number): GState {
  if (prev.game !== "lu" || prev.luDie !== null || prev.luResult) return prev;
  return { ...prev, luDie: v };
}

function applyLuPass(prev: GState): GState {
  if (prev.game !== "lu" || prev.luDie === null) return prev;
  return { ...prev, luDie: null, luTurn: prev.luTurn === "A" ? "B" : "A" };
}

function applyLuMove(prev: GState, token: number): GState {
  if (prev.game !== "lu" || prev.luDie === null || prev.luResult) return prev;
  const die = prev.luDie;
  const seat = prev.luTurn;
  const base = seat === "A" ? 0 : 4;
  if (token < base || token >= base + 4) return prev;
  const tokens = prev.luTokens.slice();
  let p = tokens[token];
  if (p === -1) {
    if (die !== 6) return prev;
    p = 0;
  } else {
    if (p + die > 56) return prev;
    p += die;
  }
  tokens[token] = p;

  // Capture any opponent token sharing this loop cell (unless it's a safe cell).
  let captured = false;
  if (p >= 0 && p <= 50) {
    const abs = (luStart(seat) + p) % 52;
    if (!LU_SAFE.has(abs)) {
      const opp: Seat = seat === "A" ? "B" : "A";
      const ob = opp === "A" ? 0 : 4;
      for (let o = ob; o < ob + 4; o++) {
        const op = tokens[o];
        if (op >= 0 && op <= 50 && (luStart(opp) + op) % 52 === abs) {
          tokens[o] = -1;
          captured = true;
        }
      }
    }
  }

  const reachedHome = p === 56;
  const allHome = [0, 1, 2, 3].every((k) => tokens[base + k] === 56);
  const result: Seat | null = allHome ? seat : null;
  const extra = die === 6 || captured || reachedHome; // roll again
  const turn: Seat = extra ? seat : seat === "A" ? "B" : "A";
  return { ...prev, luTokens: tokens, luDie: null, luTurn: turn, luResult: result };
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
  // checkers
  ckBoard: CkPiece[];
  ckSeat: Seat | null;
  ckTurn: Seat;
  ckMust: number | null;
  ckResult: Seat | null;
  // battleship (own board is secret; only this device knows bsBoard)
  bsBoard: number[];
  bsIncoming: boolean[];
  bsShots: ("hit" | "miss" | null)[];
  bsSeat: Seat | null;
  bsTurn: Seat;
  bsResult: Seat | null;
  // ludo
  luTokens: number[];
  luSeat: Seat | null;
  luTurn: Seat;
  luDie: number | null;
  luResult: Seat | null;
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
  ckBoard: [],
  ckSeat: null,
  ckTurn: "A",
  ckMust: null,
  ckResult: null,
  bsBoard: Array(BS_N * BS_N).fill(0),
  bsIncoming: Array(BS_N * BS_N).fill(false),
  bsShots: Array(BS_N * BS_N).fill(null),
  bsSeat: null,
  bsTurn: "A",
  bsResult: null,
  luTokens: Array(8).fill(-1),
  luSeat: null,
  luTurn: "A",
  luDie: null,
  luResult: null,
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
  if (game === "ck")
    return { ...base, ckBoard: ckInitBoard(), ckSeat: role === "host" ? "A" : "B", ckTurn: "A" };
  if (game === "bs")
    return { ...base, bsBoard: bsRandomBoard(), bsSeat: role === "host" ? "A" : "B", bsTurn: "A" };
  if (game === "lu") return { ...base, luSeat: role === "host" ? "A" : "B", luTurn: "A" };
  return base;
}

// Derives host/guest from the player's assigned colour/mark, so a rematch keeps
// the same sides.
function roleOf(p: GState): "host" | "guest" {
  if (p.game === "c4") return p.c4Disc === "R" ? "host" : "guest";
  if (p.game === "db") return p.dbSeat === "A" ? "host" : "guest";
  if (p.game === "mem") return p.memSeat === "A" ? "host" : "guest";
  if (p.game === "ck") return p.ckSeat === "A" ? "host" : "guest";
  if (p.game === "bs") return p.bsSeat === "A" ? "host" : "guest";
  if (p.game === "lu") return p.luSeat === "A" ? "host" : "guest";
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
  ckBoard: CkPiece[];
  ckSeat: Seat | null;
  ckTurn: Seat;
  ckMust: number | null;
  ckResult: Seat | null;
  bsIncoming: boolean[];
  bsBoard: number[];
  bsShots: ("hit" | "miss" | null)[];
  bsSeat: Seat | null;
  bsTurn: Seat;
  bsResult: Seat | null;
  luTokens: number[];
  luSeat: Seat | null;
  luTurn: Seat;
  luDie: number | null;
  luResult: Seat | null;
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
  playCk: (from: number, to: number) => void;
  fireBs: (i: number) => void;
  rollLu: () => void;
  moveLu: (token: number) => void;
  passLu: () => void;
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
      .on("broadcast", { event: "ck_move" }, ({ payload }) => {
        const from = payload?.from as number;
        const to = payload?.to as number;
        if (typeof from !== "number" || typeof to !== "number") return;
        setState((p) => (p.phase === "playing" && p.game === "ck" ? applyCkMove(p, from, to) : p));
      })
      .on("broadcast", { event: "bs_fire" }, ({ payload }) => {
        // The partner fired at MY secret board; mark it and reply with the result.
        const i = payload?.i as number;
        if (typeof i !== "number") return;
        const p = stateRef.current;
        if (p.game !== "bs" || p.phase !== "playing" || p.bsResult || p.bsIncoming[i]) return;
        const incoming = p.bsIncoming.slice();
        incoming[i] = true;
        const hit = p.bsBoard[i] !== 0;
        const lost = bsAllSunk(p.bsBoard, incoming);
        const firer: Seat = p.bsSeat === "A" ? "B" : "A";
        setState((q) => ({
          ...q,
          bsIncoming: incoming,
          bsTurn: p.bsSeat!,
          bsResult: lost ? firer : q.bsResult,
        }));
        send("bs_result", { i, hit, lost });
      })
      .on("broadcast", { event: "bs_result" }, ({ payload }) => {
        // Result of MY shot on the partner's board.
        const i = payload?.i as number;
        const hit = Boolean(payload?.hit);
        const lost = Boolean(payload?.lost);
        if (typeof i !== "number") return;
        setState((p) => {
          if (p.game !== "bs") return p;
          const shots = p.bsShots.slice();
          shots[i] = hit ? "hit" : "miss";
          return { ...p, bsShots: shots, bsResult: lost ? p.bsSeat : p.bsResult };
        });
      })
      .on("broadcast", { event: "lu_roll" }, ({ payload }) => {
        const v = payload?.v as number;
        if (typeof v !== "number") return;
        setState((p) => applyLuRoll(p, v));
      })
      .on("broadcast", { event: "lu_move" }, ({ payload }) => {
        const token = payload?.token as number;
        if (typeof token !== "number") return;
        setState((p) => applyLuMove(p, token));
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
          if (
            p.game === "ttt" ||
            p.game === "c4" ||
            p.game === "db" ||
            p.game === "ck" ||
            p.game === "bs" ||
            p.game === "lu"
          ) {
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

  const playCk = useCallback(
    (from: number, to: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "ck" || s.ckResult || s.ckTurn !== s.ckSeat) return;
      const next = applyCkMove(s, from, to);
      if (next === s) return; // illegal
      setState(next);
      send("ck_move", { from, to });
    },
    [send]
  );

  const fireBs = useCallback(
    (i: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "bs" || s.bsResult) return;
      if (s.bsSeat !== s.bsTurn || s.bsShots[i]) return;
      const opp: Seat = s.bsSeat === "A" ? "B" : "A";
      setState((p) => ({ ...p, bsTurn: opp })); // hand the turn over; result fills the shot in
      send("bs_fire", { i });
    },
    [send]
  );

  const rollLu = useCallback(() => {
    const s = stateRef.current;
    if (s.phase !== "playing" || s.game !== "lu" || s.luResult) return;
    if (s.luTurn !== s.luSeat || s.luDie !== null) return;
    const v = Math.floor(Math.random() * 6) + 1;
    setState((p) => applyLuRoll(p, v));
    send("lu_roll", { v });
  }, [send]);

  const moveLu = useCallback(
    (token: number) => {
      const s = stateRef.current;
      if (s.phase !== "playing" || s.game !== "lu" || s.luDie === null || s.luResult) return;
      if (s.luTurn !== s.luSeat) return;
      if (!luMovable(s.luTokens, s.luTurn, s.luDie).includes(token)) return;
      setState((p) => applyLuMove(p, token));
      send("lu_move", { token });
    },
    [send]
  );

  // Deterministic auto-pass when a roll has no legal moves (both phones run it).
  const passLu = useCallback(() => {
    setState((p) => applyLuPass(p));
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
    if (
      p.game === "ttt" ||
      p.game === "c4" ||
      p.game === "db" ||
      p.game === "ck" ||
      p.game === "bs" ||
      p.game === "lu"
    ) {
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
    ckBoard: state.ckBoard,
    ckSeat: state.ckSeat,
    ckTurn: state.ckTurn,
    ckMust: state.ckMust,
    ckResult: state.ckResult,
    bsBoard: state.bsBoard,
    bsIncoming: state.bsIncoming,
    bsShots: state.bsShots,
    bsSeat: state.bsSeat,
    bsTurn: state.bsTurn,
    bsResult: state.bsResult,
    luTokens: state.luTokens,
    luSeat: state.luSeat,
    luTurn: state.luTurn,
    luDie: state.luDie,
    luResult: state.luResult,
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
    playCk,
    fireBs,
    rollLu,
    moveLu,
    passLu,
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
        {phase === "playing" && game.game === "ck" && (
          <CkBoard game={game} partnerName={partnerName} />
        )}
        {phase === "playing" && game.game === "bs" && (
          <BsBoard game={game} partnerName={partnerName} />
        )}
        {phase === "playing" && game.game === "lu" && (
          <LuBoard game={game} partnerName={partnerName} />
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

function CkBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { ckBoard, ckSeat, ckTurn, ckMust, ckResult } = game;
  const [localSel, setLocalSel] = useState<number | null>(null);
  const myTurn = !ckResult && ckTurn === ckSeat;
  const sel = ckMust !== null ? ckMust : localSel;
  const dests = sel !== null && myTurn ? ckMoves(ckBoard, sel).map((m) => m.to) : [];

  let status: string;
  let tone = "text-neutral-500";
  if (ckResult) {
    const iWon = ckResult === ckSeat;
    status = iWon ? "You win! 🎉" : `${partnerName} wins 😄`;
    tone = iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (myTurn) {
    status = ckMust !== null ? "Keep jumping!" : "Your turn";
    tone = "text-emerald-500";
  } else {
    status = `${partnerName}’s turn…`;
  }

  const flip = ckSeat === "B"; // each player sees their own pieces at the bottom
  const onTap = (abs: number) => {
    if (!myTurn) return;
    if (ckMust === null && ckOwner(ckBoard[abs]) === ckSeat) {
      setLocalSel(abs);
      return;
    }
    if (sel !== null && dests.includes(abs)) {
      game.playCk(sel, abs);
      setLocalSel(null);
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Checkers</p>
        <p className="text-xs text-neutral-400">
          You are{" "}
          <span className={ckSeat === "A" ? "text-red-500" : "text-neutral-500"}>
            {ckSeat === "A" ? "Red" : "White"}
          </span>
        </p>
      </div>
      <p className={`mb-3 text-sm font-medium ${tone}`}>{status}</p>

      <div className="mx-auto grid w-full max-w-[300px] grid-cols-8 overflow-hidden rounded-lg">
        {Array.from({ length: CK_N * CK_N }).map((_, d) => {
          const abs = flip ? CK_N * CK_N - 1 - d : d;
          const r = Math.floor(abs / CK_N);
          const c = abs % CK_N;
          const dark = (r + c) % 2 === 1;
          const piece = ckBoard[abs];
          const owner = ckOwner(piece);
          return (
            <button
              key={d}
              type="button"
              disabled={!myTurn}
              onClick={() => onTap(abs)}
              className={`relative flex aspect-square items-center justify-center ${
                dark ? "bg-amber-800/80" : "bg-amber-200"
              } ${sel === abs ? "ring-2 ring-inset ring-emerald-400" : ""}`}
            >
              {owner && (
                <span
                  className={`flex h-[76%] w-[76%] items-center justify-center rounded-full text-xs shadow ${
                    owner === "A"
                      ? "bg-red-500 text-amber-100"
                      : "bg-neutral-100 text-amber-700"
                  }`}
                >
                  {ckKing(piece) ? "♛" : ""}
                </span>
              )}
              {dests.includes(abs) && (
                <span className="absolute h-2.5 w-2.5 rounded-full bg-emerald-400/90" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {ckResult && <Btn variant="primary" onClick={game.rematch}>Play again</Btn>}
      </div>
    </div>
  );
}

function BsBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { bsBoard, bsIncoming, bsShots, bsSeat, bsTurn, bsResult } = game;
  const myTurn = !bsResult && bsSeat === bsTurn;

  let status: string;
  let tone = "text-neutral-500";
  if (bsResult) {
    const iWon = bsResult === bsSeat;
    status = iWon ? "You sank their fleet! 🎉" : `${partnerName} sank your fleet 😬`;
    tone = iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (myTurn) {
    status = "Your turn — fire!";
    tone = "text-emerald-500";
  } else {
    status = `${partnerName} is aiming…`;
  }

  const myShipsLeft = bsBoard.filter((v, i) => v !== 0 && !bsIncoming[i]).length;
  const enemyHits = bsShots.filter((s) => s === "hit").length;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Battleship</p>
        <p className="text-xs text-neutral-400">🎯 {enemyHits} hits</p>
      </div>
      <p className={`mb-3 text-sm font-medium ${tone}`}>{status}</p>

      <p className="mb-1 text-xs font-medium text-neutral-500">Enemy waters — tap to fire</p>
      <div className="mx-auto mb-4 grid max-w-[260px] grid-cols-6 gap-1">
        {Array.from({ length: BS_N * BS_N }).map((_, i) => {
          const sh = bsShots[i];
          return (
            <button
              key={i}
              type="button"
              disabled={!myTurn || Boolean(sh)}
              onClick={() => game.fireBs(i)}
              aria-label="Fire here"
              className={`grid aspect-square place-items-center rounded text-sm transition active:scale-95 ${
                sh === "hit"
                  ? "bg-red-500 text-white"
                  : sh === "miss"
                    ? "bg-neutral-300 dark:bg-neutral-700"
                    : "bg-sky-200 active:bg-sky-300 dark:bg-sky-900/60"
              }`}
            >
              {sh === "hit" ? "💥" : sh === "miss" ? "•" : ""}
            </button>
          );
        })}
      </div>

      <p className="mb-1 text-xs font-medium text-neutral-500">Your fleet · {myShipsLeft} cells left</p>
      <div className="mx-auto grid max-w-[170px] grid-cols-6 gap-0.5">
        {Array.from({ length: BS_N * BS_N }).map((_, i) => {
          const ship = bsBoard[i] !== 0;
          const hit = bsIncoming[i];
          return (
            <span
              key={i}
              className={`grid aspect-square place-items-center rounded-sm text-[10px] ${
                hit
                  ? ship
                    ? "bg-red-500"
                    : "bg-neutral-400"
                  : ship
                    ? "bg-slate-500"
                    : "bg-sky-100 dark:bg-sky-900/40"
              }`}
            >
              {hit ? (ship ? "💥" : "•") : ""}
            </span>
          );
        })}
      </div>

      <div className="mt-5 flex gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {bsResult && <Btn variant="primary" onClick={game.rematch}>Play again</Btn>}
      </div>
    </div>
  );
}

// Background colour for one cell of the 15×15 Ludo board.
function luCellClass(r: number, c: number): string {
  const border = "border border-black/10";
  const baseInner = "bg-white";
  if (r < 6 && c < 6) return r >= 1 && r <= 4 && c >= 1 && c <= 4 ? baseInner : "bg-red-500";
  if (r < 6 && c > 8) return r >= 1 && r <= 4 && c >= 10 && c <= 13 ? baseInner : "bg-blue-500";
  if (r > 8 && c < 6) return r >= 10 && r <= 13 && c >= 1 && c <= 4 ? baseInner : "bg-green-500";
  if (r > 8 && c > 8) return r >= 10 && r <= 13 && c >= 10 && c <= 13 ? baseInner : "bg-yellow-400";
  if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return "bg-transparent"; // centre (pinwheel overlay)
  if (r === 7 && c >= 1 && c <= 5) return `bg-red-400 ${border}`;
  if (c === 7 && r >= 1 && r <= 5) return `bg-blue-400 ${border}`;
  if (r === 7 && c >= 9 && c <= 13) return `bg-yellow-300 ${border}`;
  if (c === 7 && r >= 9 && r <= 13) return `bg-green-400 ${border}`;
  if (r === 6 && c === 1) return `bg-red-300 ${border}`;
  if (r === 1 && c === 8) return `bg-blue-300 ${border}`;
  if (r === 8 && c === 13) return `bg-yellow-200 ${border}`;
  if (r === 13 && c === 6) return `bg-green-300 ${border}`;
  return `bg-white ${border}`;
}

const LU_STARS = new Set(["2,6", "6,12", "12,8", "8,2", "6,1", "1,8", "8,13", "13,6"]);

// A real dice face with pip dots, laid out on a 3×3 grid.
const DICE_PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
function LuDice({ value }: { value: number }) {
  const pips = DICE_PIPS[value] ?? [];
  return (
    <div
      key={value}
      className="lu-die-pop grid h-14 w-14 shrink-0 grid-cols-3 grid-rows-3 gap-0.5 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-black/10"
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className="flex items-center justify-center">
          {pips.includes(i) && <span className="h-2.5 w-2.5 rounded-full bg-neutral-900" />}
        </span>
      ))}
    </div>
  );
}

function LuBoard({ game, partnerName }: { game: CoupleGame; partnerName: string }) {
  const { luTokens, luSeat, luTurn, luDie, luResult } = game;
  const myTurn = !luResult && luTurn === luSeat;
  const movable = luDie !== null && myTurn ? luMovable(luTokens, luTurn, luDie) : [];

  // Auto-pass a roll with no legal moves (both phones run this deterministically).
  const tokenKey = luTokens.join(",");
  useEffect(() => {
    if (luDie === null || luResult) return;
    if (luMovable(luTokens, luTurn, luDie).length > 0) return;
    const t = setTimeout(() => game.passLu(), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [luDie, luTurn, tokenKey, luResult]);

  let status: string;
  let tone = "text-neutral-500";
  if (luResult) {
    const iWon = luResult === luSeat;
    status = iWon ? "You win! 🎉" : `${partnerName} wins 😄`;
    tone = iWon ? "text-emerald-500" : "text-fuchsia-500";
  } else if (!myTurn) {
    status = `${partnerName}’s turn…`;
  } else if (luDie === null) {
    status = "Your turn — roll the dice!";
    tone = "text-emerald-500";
  } else if (movable.length === 0) {
    status = `Rolled ${luDie} — no moves`;
  } else {
    status = `Rolled ${luDie} — tap a glowing token`;
    tone = "text-emerald-500";
  }

  // Place tokens and record stacking per cell so overlaps spread out.
  const tokens = luTokens.map((p, t) => {
    const owner: Seat = t < 4 ? "A" : "B";
    const [row, col] = luTokenCell(owner, p, t % 4);
    return { t, owner, row, col };
  });
  const stackAt = new Map<string, number[]>();
  tokens.forEach(({ t, row, col }) => {
    const key = `${row},${col}`;
    stackAt.set(key, [...(stackAt.get(key) ?? []), t]);
  });

  const pct = 100 / 15;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="font-semibold text-neutral-900 dark:text-neutral-100">Ludo</p>
        <p className="text-xs text-neutral-400">
          You are{" "}
          <span className={luSeat === "A" ? "text-red-500" : "text-yellow-500"}>
            {luSeat === "A" ? "Red" : "Yellow"}
          </span>
        </p>
      </div>
      <p className={`mb-3 text-sm font-medium ${tone}`}>{status}</p>

      <div className="relative mx-auto aspect-square w-full max-w-[320px] overflow-hidden rounded-lg shadow">
        {/* Board background */}
        <div className="grid h-full w-full" style={{ gridTemplateColumns: "repeat(15, 1fr)" }}>
          {Array.from({ length: 225 }).map((_, k) => {
            const r = Math.floor(k / 15);
            const c = k % 15;
            return (
              <div
                key={k}
                className={`flex items-center justify-center ${luCellClass(r, c)}`}
              >
                {LU_STARS.has(`${r},${c}`) && (
                  <span className="text-[7px] leading-none text-black/40">★</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Centre pinwheel */}
        <div
          className="absolute"
          style={{
            left: `${6 * pct}%`,
            top: `${6 * pct}%`,
            width: `${3 * pct}%`,
            height: `${3 * pct}%`,
            background:
              "conic-gradient(from 45deg, #ef4444 0 90deg, #facc15 90deg 180deg, #22c55e 180deg 270deg, #3b82f6 270deg 360deg)",
          }}
        />

        {/* Tokens */}
        {tokens.map(({ t, owner, row, col }) => {
          const stack = stackAt.get(`${row},${col}`) ?? [t];
          const idxIn = stack.indexOf(t);
          const off = stack.length > 1 ? (idxIn - (stack.length - 1) / 2) * (pct * 0.5) : 0;
          const can = owner === luSeat && movable.includes(t);
          return (
            <button
              key={t}
              type="button"
              disabled={!can}
              onClick={() => game.moveLu(t)}
              className="absolute flex items-center justify-center p-0"
              style={{
                top: `${row * pct}%`,
                left: `${col * pct + off}%`,
                width: `${pct}%`,
                height: `${pct}%`,
              }}
            >
              <span
                className={`h-[80%] w-[80%] rounded-full border-2 border-white shadow-md ${
                  owner === "A" ? "bg-red-500" : "bg-yellow-400"
                } ${can ? "ring-2 ring-emerald-400" : ""}`}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Btn variant="ghost" onClick={game.close}>Close</Btn>
        {luDie !== null && <LuDice value={luDie} />}
        {luResult ? (
          <Btn variant="primary" onClick={game.rematch}>Play again</Btn>
        ) : myTurn && luDie === null ? (
          <Btn variant="primary" onClick={game.rollLu}>🎲 Roll</Btn>
        ) : (
          <span className="flex-1" />
        )}
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
