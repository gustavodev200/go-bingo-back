import { DAMAS_SIZE, type DamasMove } from '../../contracts';
import type { RandomInt } from '../../core/random';
import type { Announcement, DamasMatch } from './match';
import {
  applyMove,
  BLACK,
  boardFromString,
  legalMoves,
  promotionRow,
  WHITE,
  type Board,
  type Side,
} from './rules';

/** How many plies the CPU looks ahead (its move, the reply, its next move). */
const DEPTH = 3;

/** Material (king = 3 men) plus a small push towards promotion, from `side`'s point of view. */
function evaluate(board: Board, side: Side): number {
  let score = 0;
  for (let sq = 0; sq < board.length; sq++) {
    const piece = board[sq];
    if (piece === 0) continue;
    const owner = Math.sign(piece) as Side;
    const row = Math.floor(sq / DAMAS_SIZE);
    const advance =
      Math.abs(piece) === 1
        ? (DAMAS_SIZE - 1 - Math.abs(promotionRow(owner) - row)) * 0.05
        : 0;
    const value = (Math.abs(piece) === 2 ? 3 : 1) + advance;
    score += owner === side ? value : -value;
  }
  return score;
}

function search(
  board: Board,
  toMove: Side,
  me: Side,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const moves = legalMoves(board, toMove);
  if (moves.length === 0) return toMove === me ? -1000 : 1000;
  if (depth === 0) return evaluate(board, me);
  const next = toMove === WHITE ? BLACK : WHITE;
  if (toMove === me) {
    let best = -Infinity;
    for (const m of moves) {
      const copy = board.slice();
      applyMove(copy, m);
      best = Math.max(best, search(copy, next, me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const copy = board.slice();
    applyMove(copy, m);
    best = Math.min(best, search(copy, next, me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** Best move by a short alpha-beta search; ties are broken at random so games vary. */
export function damasBestMove(
  boardText: string,
  side: Side,
  moves: readonly DamasMove[],
  random: RandomInt,
): DamasMove {
  const board = boardFromString(boardText);
  const next = side === WHITE ? BLACK : WHITE;
  let best: DamasMove[] = [];
  let bestScore = -Infinity;
  for (const m of moves) {
    const copy = board.slice();
    applyMove(copy, m);
    const score = search(copy, next, side, DEPTH - 1, -Infinity, Infinity);
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = [m];
    } else if (Math.abs(score - bestScore) <= 1e-9) best.push(m);
  }
  return best[random(0, best.length)];
}

/** One turn of a CPU seat: plays the best move it finds (a pending draw offer is declined by moving). */
export function damasBotTurn(
  match: DamasMatch,
  seat: number,
  random: RandomInt,
): Announcement[] {
  const view = match.publicView();
  if (match.turnSeat !== seat || view.moves.length === 0) return [];
  const side = view.turn === 'white' ? WHITE : BLACK;
  const move = damasBestMove(view.board, side, view.moves, random);
  return match.move(seat, move.from, move.path);
}
