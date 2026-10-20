import { isDouble, tilePips, type DominoSide } from '../../contracts';
import type { Announcement, DominoMatch } from './match';

/**
 * One turn of a CPU seat, using only what that seat could see: buys when nothing fits,
 * then gets rid of doubles and heavy tiles first, choosing the end that leaves a number
 * it still holds (so it is not blocked on the next turn).
 */
export function dominoBotTurn(
  match: DominoMatch,
  seat: number,
): Announcement[] {
  const view = match.publicView();
  const hand = match.privateView(seat);
  if (!hand || view.turn !== seat) return [];
  if (hand.playable.length === 0)
    return hand.mustDraw ? match.draw(seat) : match.timeout();

  const tiles = new Map(hand.tiles.map((t) => [t.id, t.tile]));
  let best: { id: string; side: DominoSide; score: number } | null = null;
  for (const p of hand.playable) {
    const tile = tiles.get(p.id)!;
    for (const side of p.sides) {
      const rest = hand.tiles.filter((t) => t.id !== p.id);
      const end = view.ends
        ? side === 'left'
          ? view.ends[0]
          : view.ends[1]
        : null;
      const open = end === null ? tile.b : tile.a === end ? tile.b : tile.a;
      const follow = rest.filter(
        (t) => t.tile.a === open || t.tile.b === open,
      ).length;
      const score = tilePips(tile) + (isDouble(tile) ? 6 : 0) + follow * 3;
      if (!best || score > best.score) best = { id: p.id, side, score };
    }
  }
  return match.play(seat, best!.id, best!.side);
}
