import {
  DAMAS_SIZE,
  DAMAS_SQUARES,
  type DamasCell,
  type DamasMove,
} from '../../contracts';

/**
 * Pure move generation for Brazilian draughts on an 8x8 board.
 *
 * Board: one number per square. 0 = empty, +1 white man, +2 white king,
 * -1 black man, -2 black king. White moves up (towards row 0).
 *
 * - men move one square diagonally forward and capture forwards and backwards;
 * - kings fly: any distance diagonally, capturing at a distance;
 * - capturing is mandatory and the line taking the most pieces must be chosen
 *   (lei da maioria; men and kings count the same);
 * - a capture goes on while the piece can keep jumping; captured pieces stay on
 *   the board until the move ends, so they block and cannot be jumped twice;
 * - a man only becomes a king when the move ends on the far row (passing
 *   through it in the middle of a capture does not promote).
 */
export type Board = Int8Array;

export const WHITE = 1;
export const BLACK = -1;
export type Side = typeof WHITE | typeof BLACK;

const DIRS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const CELL_OF: Record<number, DamasCell> = {
  0: '.',
  1: 'w',
  2: 'W',
  [-1]: 'b',
  [-2]: 'B',
};
const VALUE_OF: Record<DamasCell, number> = {
  '.': 0,
  w: 1,
  W: 2,
  b: -1,
  B: -2,
};

export function boardFromString(text: string): Board {
  const board = new Int8Array(DAMAS_SQUARES);
  for (let i = 0; i < DAMAS_SQUARES; i++)
    board[i] = VALUE_OF[text[i] as DamasCell] ?? 0;
  return board;
}

export function boardToString(board: Board): string {
  let out = '';
  for (let i = 0; i < DAMAS_SQUARES; i++) out += CELL_OF[board[i]];
  return out;
}

const inside = (row: number, col: number) =>
  row >= 0 && row < DAMAS_SIZE && col >= 0 && col < DAMAS_SIZE;

/** Row a man of this side must end a move on to become a king. */
export const promotionRow = (side: Side) =>
  side === WHITE ? 0 : DAMAS_SIZE - 1;

export function countPieces(board: Board, side: Side): number {
  let n = 0;
  for (let i = 0; i < DAMAS_SQUARES; i++) if (board[i] * side > 0) n++;
  return n;
}

/** Every capture line of the piece on `from` (not yet filtered by the majority rule). */
function capturesFrom(board: Board, from: number, out: DamasMove[]): void {
  const piece = board[from];
  const side = Math.sign(piece);
  const king = Math.abs(piece) === 2;
  const taken = new Set<number>();
  const path: number[] = [];
  // The moving piece has left its square: it no longer blocks anything.
  const empty = (sq: number) => sq === from || board[sq] === 0;

  const visit = (sq: number) => {
    const row = Math.floor(sq / DAMAS_SIZE);
    const col = sq % DAMAS_SIZE;
    let extended = false;
    for (const [dr, dc] of DIRS) {
      let r = row + dr;
      let c = col + dc;
      if (king)
        while (inside(r, c) && empty(r * DAMAS_SIZE + c)) {
          r += dr;
          c += dc;
        }
      if (!inside(r, c)) continue;
      const victim = r * DAMAS_SIZE + c;
      if (board[victim] * side >= 0 || taken.has(victim)) continue;
      let lr = r + dr;
      let lc = c + dc;
      taken.add(victim);
      while (inside(lr, lc) && empty(lr * DAMAS_SIZE + lc)) {
        const landing = lr * DAMAS_SIZE + lc;
        extended = true;
        path.push(landing);
        visit(landing);
        path.pop();
        if (!king) break;
        lr += dr;
        lc += dc;
      }
      taken.delete(victim);
    }
    // `taken` keeps insertion order, so captures come in the order they were jumped.
    if (!extended && path.length > 0)
      out.push({ from, path: [...path], captures: [...taken] });
  };
  visit(from);
}

function simpleMovesFrom(board: Board, from: number, out: DamasMove[]): void {
  const piece = board[from];
  const side = Math.sign(piece);
  const king = Math.abs(piece) === 2;
  const row = Math.floor(from / DAMAS_SIZE);
  const col = from % DAMAS_SIZE;
  for (const [dr, dc] of DIRS) {
    if (!king && dr !== -side) continue;
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c) && board[r * DAMAS_SIZE + c] === 0) {
      out.push({ from, path: [r * DAMAS_SIZE + c], captures: [] });
      if (!king) break;
      r += dr;
      c += dc;
    }
  }
}

/** All legal moves of `side`: mandatory capture and the majority rule applied. */
export function legalMoves(board: Board, side: Side): DamasMove[] {
  const captures: DamasMove[] = [];
  for (let sq = 0; sq < DAMAS_SQUARES; sq++)
    if (board[sq] * side > 0) capturesFrom(board, sq, captures);
  if (captures.length > 0) {
    const best = Math.max(...captures.map((m) => m.captures.length));
    return captures.filter((m) => m.captures.length === best);
  }
  const moves: DamasMove[] = [];
  for (let sq = 0; sq < DAMAS_SQUARES; sq++)
    if (board[sq] * side > 0) simpleMovesFrom(board, sq, moves);
  return moves;
}

export const sameMove = (a: DamasMove, from: number, path: readonly number[]) =>
  a.from === from &&
  a.path.length === path.length &&
  a.path.every((sq, i) => sq === path[i]);

/** Plays a legal move in place; true when a man was promoted. */
export function applyMove(board: Board, move: DamasMove): boolean {
  const piece = board[move.from];
  const side = Math.sign(piece) as Side;
  const to = move.path[move.path.length - 1];
  board[move.from] = 0;
  for (const sq of move.captures) board[sq] = 0;
  const promoted =
    Math.abs(piece) === 1 && Math.floor(to / DAMAS_SIZE) === promotionRow(side);
  board[to] = promoted ? side * 2 : piece;
  return promoted;
}
