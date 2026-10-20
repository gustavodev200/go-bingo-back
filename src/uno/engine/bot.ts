import {
  cardPoints,
  UNO_COLORS,
  type UnoColor,
  type UnoHandCard,
  type UnoPlayOptions,
} from '../../contracts';
import type { RandomInt } from '../../core/random';
import type { Announcement, UnoMatch } from './match';

/** Color the CPU holds most (wilds don't count); a random one when only wilds are left. */
export function favoriteColor(
  cards: readonly UnoHandCard[],
  random: RandomInt,
): UnoColor {
  const count = new Map<UnoColor, number>();
  for (const { card } of cards)
    if (card.color !== 'wild')
      count.set(card.color, (count.get(card.color) ?? 0) + 1);
  let best: UnoColor | null = null;
  for (const [color, n] of count)
    if (best === null || n > count.get(best)!) best = color;
  return best ?? UNO_COLORS[random(0, UNO_COLORS.length)];
}

/**
 * One turn of a CPU seat, using only what that seat could see: catches an exposed player,
 * shouts UNO, stacks/challenges when it pays off and plays the card that hurts the most
 * (actions when the next player is close to winning, high cards otherwise, wilds last).
 */
export function unoBotTurn(
  match: UnoMatch,
  seat: number,
  random: RandomInt,
): Announcement[] {
  const view = match.publicView();
  const hand = match.privateView(seat);
  if (!hand || view.turn !== seat) return [];
  const out: Announcement[] = [];

  if (view.unoExposed !== null && view.unoExposed !== seat)
    out.push(...match.catchUno(seat));

  const playable = hand.cards.filter((c) => hand.playable.includes(c.id));

  if (hand.drawnCardId) {
    const drawn = hand.cards.find((c) => c.id === hand.drawnCardId);
    if (!drawn) return [...out, ...match.pass(seat)];
    return [...out, ...playCard(match, seat, drawn, hand.cards, random)];
  }

  if (view.pendingDraw > 0) {
    if (playable.length > 0)
      return [
        ...out,
        ...playCard(match, seat, pick(playable), hand.cards, random),
      ];
    // A +4 is a bluff about 1 in 3 times: worth the risk when the pile is still small.
    if (view.canChallenge && view.pendingDraw <= 4 && random(0, 3) === 0)
      return [...out, ...match.challenge(seat)];
    return [...out, ...match.draw(seat)];
  }

  if (playable.length === 0) return [...out, ...match.draw(seat)];

  const nextSeat = nextActive(view.handCounts, seat, view.direction);
  const threatened = nextSeat !== null && view.handCounts[nextSeat] <= 2;
  return [
    ...out,
    ...playCard(match, seat, pick(playable, threatened), hand.cards, random),
  ];
}

function playCard(
  match: UnoMatch,
  seat: number,
  card: UnoHandCard,
  hand: readonly UnoHandCard[],
  random: RandomInt,
): Announcement[] {
  const out: Announcement[] = [];
  if (hand.length === 2) out.push(...match.callUno(seat));
  const rest = hand.filter((c) => c.id !== card.id);
  const opts: UnoPlayOptions = {};
  if (card.card.color === 'wild') opts.color = favoriteColor(rest, random);
  if (card.card.value === '7') {
    // 7-0: takes the smallest hand around the table (ignored when the rule is off).
    const counts = match.publicView().handCounts;
    let target: number | undefined;
    counts.forEach((n, s) => {
      if (s !== seat && n > 0 && (target === undefined || n < counts[target]))
        target = s;
    });
    if (target !== undefined) opts.target = target;
  }
  out.push(...match.play(seat, card.id, opts));
  return out;
}

/** Best card to drop: wilds are kept for last; under threat actions come first, else the highest points. */
function pick(cards: readonly UnoHandCard[], threatened = false): UnoHandCard {
  const score = (c: UnoHandCard) => {
    if (c.card.color === 'wild') return -100 + cardPoints(c.card) / 10;
    const action =
      c.card.value === 'draw2' ||
      c.card.value === 'skip' ||
      c.card.value === 'reverse';
    return (threatened && action ? 100 : 0) + cardPoints(c.card);
  };
  return [...cards].sort((a, b) => score(b) - score(a))[0];
}

function nextActive(
  handCounts: readonly number[],
  seat: number,
  direction: 1 | -1,
): number | null {
  const n = handCounts.length;
  for (let step = 1; step < n; step++) {
    const s = (((seat + direction * step) % n) + n) % n;
    if (handCounts[s] > 0) return s;
  }
  return null;
}
