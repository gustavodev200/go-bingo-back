import {
  BJ_BET_STEP,
  BJ_MAX_BET,
  BJ_MIN_BET,
  bjCardValue,
  type BjAction,
} from '../../contracts';
import type { RandomInt } from '../../core/random';
import type { Announcement, BjMatch } from './match';

/** About a tenth of the stack, in table steps (a bit more or less each round). */
function botBet(chips: number, random: RandomInt): number {
  const target = chips * (0.06 + random(0, 7) / 100);
  const stepped = Math.round(target / BJ_BET_STEP) * BJ_BET_STEP;
  return Math.max(BJ_MIN_BET, Math.min(BJ_MAX_BET, stepped, chips));
}

/** Simplified basic strategy for the hand on turn. */
export function basicStrategy(
  total: number,
  soft: boolean,
  pair: number | null,
  dealerUp: number,
  actions: readonly BjAction[],
): BjAction {
  const can = (a: BjAction) => actions.includes(a);
  const up = dealerUp === 1 ? 11 : dealerUp;
  if (pair !== null && can('split') && (pair === 1 || pair === 8))
    return 'split';
  if (can('double')) {
    if (!soft && total === 11) return 'double';
    if (!soft && total === 10 && up <= 9) return 'double';
    if (!soft && total === 9 && up >= 3 && up <= 6) return 'double';
    if (soft && total >= 15 && total <= 18 && up >= 4 && up <= 6)
      return 'double';
  }
  if (!soft && total === 16 && up >= 9 && can('surrender')) return 'surrender';
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return up <= 8 ? 'stand' : 'hit';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  return 'hit';
}

/**
 * What the CPU seats have to do now, already applied: every CPU bets at once, declines
 * insurance at once, and plays its own hand by basic strategy. Null = nothing to do.
 */
export function bjBotAction(
  match: BjMatch,
  isBot: (seat: number) => boolean,
  random: RandomInt,
): Announcement[] | null {
  if (match.phase !== 'PLAYING') return null;
  const view = match.publicView();
  const bots = view.players.filter(
    (p): p is NonNullable<typeof p> =>
      p !== null && isBot(p.seat) && !p.left && !p.broke,
  );
  // Bets and insurance answers may announce nothing: `acted` tells the room to publish anyway.
  const out: Announcement[] = [];
  let acted = false;

  if (view.stage === 'BETTING') {
    for (const p of bots)
      if (p.bet === null && match.stage === 'BETTING') {
        out.push(...match.bet(p.seat, botBet(p.chips, random)));
        acted = true;
      }
    return acted ? out : null;
  }

  if (view.stage === 'INSURANCE') {
    for (const p of bots)
      if (
        p.insurance === null &&
        p.bet !== null &&
        match.stage === 'INSURANCE'
      ) {
        out.push(...match.insurance(p.seat, false));
        acted = true;
      }
    return acted ? out : null;
  }

  if (view.stage !== 'PLAYING' || !view.turn || !isBot(view.turn.seat))
    return null;
  const hand = view.players[view.turn.seat]!.hands[view.turn.hand];
  const upCard = view.dealer.cards[0];
  const pair =
    hand.cards.length === 2 &&
    bjCardValue(hand.cards[0]) === bjCardValue(hand.cards[1])
      ? bjCardValue(hand.cards[0])
      : null;
  const action = basicStrategy(
    hand.total,
    hand.soft,
    pair,
    upCard ? bjCardValue(upCard) : 10,
    view.actions,
  );
  return match.act(view.turn.seat, action);
}
