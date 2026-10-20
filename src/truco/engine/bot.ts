import {
  partnerOf,
  teamOf,
  type Seat,
  type TrucoCard,
  type TrucoHandCard,
} from '../../contracts';
import type { RandomInt } from '../../core/random';
import { cardStrength } from './cards';
import { nextBetValue, type Announcement, type TrucoMatch } from './match';

const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** Strength of a hand card; blind cards (mão de ferro) count as average. */
const strength = (c: TrucoHandCard) => (c.card ? cardStrength(c.card) : 6);

/** Manilhas are 11+ (Pica-fumo … Zap). */
const isManilha = (card: TrucoCard | null) =>
  card !== null && cardStrength(card) >= 11;

/**
 * The next thing a CPU seat has to do, if any, already applied to the match: decide the
 * mão de dez/14 (only when no human of that team can), vote on a bet, ask for truco or
 * play a card. Returns null when no CPU has anything to do right now.
 */
export function trucoBotAction(
  match: TrucoMatch,
  isBot: (seat: Seat) => boolean,
  random: RandomInt,
): Announcement[] | null {
  const view = match.publicView();
  if (!view || match.winner !== null) return null;

  if (view.phase === 'AWAITING_TEN_DECISION' && view.tenTeam !== null) {
    const team = SEATS.filter((s) => teamOf(s) === view.tenTeam);
    if (team.some((s) => !isBot(s))) return null;
    const seat = team[0];
    const hand = match.privateView(seat)!;
    const all = [
      ...hand.cards.map(strength),
      ...(hand.partnerCards ?? []).map(cardStrength),
    ];
    const good = all.filter((s) => s >= 8).length;
    return match.decideTen(seat, good >= 2 || Math.max(...all) >= 12);
  }

  if (view.phase === 'AWAITING_BET_RESPONSE' && view.pendingBet) {
    const responders = SEATS.filter((s) => teamOf(s) !== view.pendingBet!.team);
    for (const seat of responders) {
      if (!isBot(seat)) continue;
      const hand = match.privateView(seat)!;
      if (hand.betVotes?.mine) continue;
      const wonRounds = view.rounds.filter(
        (r) => r.result === teamOf(seat),
      ).length;
      const cards = hand.cards.map(strength);
      const manilhas = hand.cards.filter((c) => isManilha(c.card)).length;
      const best = cards.length ? Math.max(...cards) : 0;
      let response: 'run' | 'accept' | 'raise' = 'run';
      if (manilhas >= 2 || (wonRounds > 0 && best >= 12)) response = 'raise';
      else if (manilhas >= 1 || best >= 9 || wonRounds > 0) response = 'accept';
      else if (random(0, 5) === 0) response = 'accept';
      if (response === 'raise' && nextBetValue(view.pendingBet.value) === null)
        response = 'accept';
      const partner = partnerOf(seat);
      // With another CPU as partner it answers for both; a human partner still votes.
      return match.respondBet(seat, response, isBot(partner));
    }
    return null;
  }

  if (view.phase !== 'AWAITING_PLAY' || !isBot(view.turn)) return null;
  const seat = view.turn;
  const hand = match.privateView(seat)!;
  const team = teamOf(seat);

  const canBet =
    view.kind === 'normal' &&
    view.lastRaiseTeam !== team &&
    nextBetValue(view.value) !== null;
  if (canBet) {
    const manilhas = hand.cards.filter((c) => isManilha(c.card)).length;
    const wonRounds = view.rounds.filter((r) => r.result === team).length;
    const strong = manilhas >= 2 || (manilhas >= 1 && wonRounds > 0);
    if ((strong && random(0, 3) > 0) || random(0, 25) === 0)
      return match.requestBet(seat);
  }

  const round = view.rounds[view.rounds.length - 1];
  const sorted = [...hand.cards].sort((a, b) => strength(a) - strength(b));
  let card = sorted[0];
  if (round.plays.length === 0) {
    // Leading: the first round goes with the best card, later ones save it if already ahead.
    const ahead = view.rounds.some((r) => r.result === team);
    card = ahead ? sorted[0] : sorted[sorted.length - 1];
  } else {
    const top = Math.max(...round.plays.map((p) => cardStrength(p.card)));
    const topSeat = round.plays.find((p) => cardStrength(p.card) === top)!.seat;
    const partnerWinning = teamOf(topSeat) === team;
    const beats = sorted.filter((c) => c.card && cardStrength(c.card) > top);
    if (!partnerWinning && beats.length > 0) card = beats[0];
  }
  return match.play(seat, card.id);
}

/** Safety net when a choice turns out invalid: decide to play, accept, or play the first card. */
export function trucoBotFallback(
  match: TrucoMatch,
  isBot: (seat: Seat) => boolean,
): Announcement[] | null {
  const view = match.publicView();
  if (!view || match.winner !== null) return null;
  for (const seat of SEATS) {
    if (!isBot(seat)) continue;
    try {
      if (view.phase === 'AWAITING_TEN_DECISION')
        return match.decideTen(seat, true);
      if (view.phase === 'AWAITING_BET_RESPONSE')
        return match.respondBet(seat, 'accept', true);
      if (view.phase === 'AWAITING_PLAY' && view.turn === seat)
        return match.play(seat, match.privateView(seat)!.cards[0].id);
    } catch {
      // not this seat's move
    }
  }
  return null;
}
