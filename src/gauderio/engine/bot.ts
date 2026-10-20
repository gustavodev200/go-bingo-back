import {
  gaudStrength,
  gaudTeamOf,
  type GaudCall,
  type GaudHandCard,
  type GaudPrivateHand,
  type GaudSeat,
} from '../../contracts';
import type { RandomInt } from '../../core/random';
import type { Announcement, GaudMatch } from './match';

/** Strong cards: the four manilhas and the 3s (gaudStrength ≥ 10). */
const strong = (cards: readonly GaudHandCard[]) =>
  cards.filter((c) => gaudStrength(c.card) >= 10).length;

const first = (calls: readonly GaudCall[], wanted: readonly GaudCall[]) =>
  wanted.find((c) => calls.includes(c)) ?? null;

/**
 * The next thing a CPU seat has to do, already applied to the match: answer a call
 * (only when no human partner can answer it), sing flor when it must, call envido or
 * truco on its own turn when the hand is good, then play a card. Null = nothing to do.
 * Everything comes from the seat's own private view, so the CPU never peeks.
 */
export function gaudBotAction(
  match: GaudMatch,
  seats: number,
  isBot: (seat: GaudSeat) => boolean,
  random: RandomInt,
): Announcement[] | null {
  const view = match.publicView();
  if (!view || match.winner !== null) return null;
  const all = Array.from({ length: seats }, (_, s) => s as GaudSeat);
  const hands = new Map<GaudSeat, GaudPrivateHand>();
  for (const s of all) {
    const h = match.privateView(s);
    if (h) hands.set(s, h);
  }

  // 1) Answer what is pending (a human of the same team answers for it).
  for (const seat of all) {
    const hand = hands.get(seat);
    if (!isBot(seat) || !hand?.actions.canAccept) continue;
    const humanCanAnswer = all.some(
      (s) =>
        !isBot(s) &&
        gaudTeamOf(s) === gaudTeamOf(seat) &&
        hands.get(s)?.actions.canAccept,
    );
    if (humanCanAnswer) continue;
    return answer(match, seat, hand, view.pending?.kind ?? 'truco', random);
  }

  // 2) Flor must be sung before playing.
  for (const seat of all) {
    const hand = hands.get(seat);
    if (isBot(seat) && hand?.flor && hand.actions.calls.includes('flor'))
      return match.call(seat, 'flor');
  }

  // 3) Its own turn: maybe sing, then play.
  const seat = view.turn;
  const hand = hands.get(seat);
  if (!isBot(seat) || !hand?.actions.canPlay) return null;
  const calls = hand.actions.calls;
  if (hand.envido >= 28 && calls.includes('envido') && random(0, 4) > 0)
    return match.call(
      seat,
      hand.envido >= 31 ? first(calls, ['real_envido', 'envido'])! : 'envido',
    );
  const truco = first(calls, ['truco', 'retruco', 'vale4']);
  if (truco && (strong(hand.cards) >= 2 || random(0, 20) === 0))
    return match.call(seat, truco);

  const round = view.rounds[view.rounds.length - 1];
  const sorted = [...hand.cards].sort(
    (a, b) => gaudStrength(a.card) - gaudStrength(b.card),
  );
  let card = sorted[0];
  const team = gaudTeamOf(seat);
  if (round.plays.length === 0) {
    const ahead = view.rounds.some((r) => r.result === team);
    card = ahead ? sorted[0] : sorted[sorted.length - 1];
  } else {
    const shown = round.plays.filter((p) => p.card && !p.hidden);
    const top = shown.length
      ? Math.max(...shown.map((p) => gaudStrength(p.card!)))
      : 0;
    const topSeat = shown.find((p) => gaudStrength(p.card!) === top)?.seat;
    const partnerWinning =
      topSeat !== undefined && gaudTeamOf(topSeat) === team;
    const beats = sorted.filter((c) => gaudStrength(c.card) > top);
    if (!partnerWinning && beats.length > 0) card = beats[0];
  }
  return match.play(seat, card.id);
}

function answer(
  match: GaudMatch,
  seat: GaudSeat,
  hand: GaudPrivateHand,
  kind: 'truco' | 'envido' | 'flor',
  random: RandomInt,
): Announcement[] {
  const calls = hand.actions.calls;
  if (kind === 'flor') {
    const raise = hand.flor ? first(calls, ['contraflor']) : null;
    if (raise && random(0, 2) === 0) return match.call(seat, raise);
    return match.respond(seat, hand.flor || !hand.actions.canDecline);
  }
  if (kind === 'envido') {
    if (hand.envido >= 31) {
      const raise = first(calls, ['real_envido', 'falta_envido']);
      if (raise && random(0, 2) === 0) return match.call(seat, raise);
    }
    return match.respond(seat, hand.envido >= 26 || !hand.actions.canDecline);
  }
  // Truco: a pending truco can be answered with envido first ("envido está primero").
  if (hand.envido >= 29 && calls.includes('envido'))
    return match.call(seat, 'envido');
  const power = strong(hand.cards);
  const raise = first(calls, ['retruco', 'vale4']);
  if (raise && power >= 2) return match.call(seat, raise);
  const accept = power >= 1 || random(0, 5) === 0;
  return match.respond(seat, accept || !hand.actions.canDecline);
}

/** Safety net when a choice turns out invalid: accept, play the first card or fold. */
export function gaudBotFallback(
  match: GaudMatch,
  seats: number,
  isBot: (seat: GaudSeat) => boolean,
): Announcement[] | null {
  for (let s = 0; s < seats; s++) {
    const seat = s as GaudSeat;
    const hand = isBot(seat) ? match.privateView(seat) : null;
    if (!hand) continue;
    if (hand.actions.canAccept) return match.respond(seat, true);
    if (hand.actions.canPlay) return match.play(seat, hand.cards[0].id);
    if (hand.actions.calls.includes('flor')) return match.call(seat, 'flor');
    if (hand.actions.canFold) return match.fold(seat);
  }
  return null;
}
