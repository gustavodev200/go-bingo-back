import type { Seat, TrucoCard } from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { sameCard } from './cards';
import { handWinner, TrucoMatch, type Announcement } from './match';

const c = (rank: TrucoCard['rank'], suit: TrucoCard['suit']): TrucoCard => ({
  rank,
  suit,
});

/** Hands for seats 0..3 (3 cards each). Dealer 3 → seat 0 starts. */
const HAND_A: TrucoCard[][] = [
  [c('3', 'clubs'), c('2', 'clubs'), c('5', 'clubs')],
  [c('K', 'clubs'), c('K', 'hearts'), c('6', 'clubs')],
  [c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts')],
  [c('Q', 'clubs'), c('Q', 'hearts'), c('6', 'spades')],
];

function newMatch(
  deals: TrucoCard[][][] = [HAND_A],
  init: { scores?: [number, number]; dealer?: Seat } = {},
) {
  let i = 0;
  return new TrucoMatch(() => 0, {
    dealer: init.dealer ?? 3,
    scores: init.scores,
    deck: () => deals[Math.min(i++, deals.length - 1)].flat(),
  });
}

function play(m: TrucoMatch, seat: Seat, card: TrucoCard): Announcement[] {
  const found = m
    .privateView(seat)!
    .cards.find((h) => h.card && sameCard(h.card, card));
  if (!found) throw new Error(`seat ${seat} has no ${card.rank}${card.suit}`);
  return m.play(seat, found.id);
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const events = (out: Announcement[]) => out.map((a) => a.event);

describe('handWinner', () => {
  it.each([
    [[0], undefined],
    [[0, 1], undefined],
    [[0, 0], 0],
    [[1, 0, 1], 1],
    [['tie'], undefined],
    [['tie', 1], 1],
    [[0, 'tie'], 0],
    [[1, 0, 'tie'], 1],
    [['tie', 'tie'], undefined],
    [['tie', 'tie', 0], 0],
    [['tie', 'tie', 'tie'], 'void'],
  ] as const)('%j → %s', (results, expected) => {
    expect(handWinner(results)).toBe(expected);
  });
});

describe('TrucoMatch — dealing and turns', () => {
  it('deals 3 unique cards per seat and shows each player only their own', () => {
    const m = new TrucoMatch(
      (() => {
        let n = 3;
        return (min: number, max: number) => {
          n = (n * 17 + 5) % 101;
          return min + (n % (max - min));
        };
      })(),
      { dealer: 0 },
    );
    m.deal();
    const all = ([0, 1, 2, 3] as const).flatMap((s) =>
      m.privateView(s)!.cards.map((h) => `${h.card!.rank}${h.card!.suit}`),
    );
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
    const view = m.publicView()!;
    expect(view.cardsLeft).toEqual([3, 3, 3, 3]);
    expect(JSON.stringify(view)).not.toMatch(/"rank"/);
    expect(m.privateView(0)!.partnerCards).toBeNull();
  });

  it('starts with the player after the dealer and enforces the turn order', () => {
    const m = newMatch();
    m.deal();
    expect(m.publicView()!.turn).toBe(0);
    expect(code(() => play(m, 1, c('K', 'clubs')))).toBe('NOT_YOUR_TURN');
    play(m, 0, c('3', 'clubs'));
    expect(m.publicView()!.turn).toBe(1);
    expect(code(() => play(m, 0, c('2', 'clubs')))).toBe('NOT_YOUR_TURN');
  });

  it('rejects a card that was already played or is not in the hand', () => {
    const m = newMatch();
    m.deal();
    const id = m.privateView(0)!.cards[0].id;
    m.play(0, id);
    play(m, 1, c('K', 'clubs'));
    play(m, 2, c('4', 'hearts'));
    play(m, 3, c('Q', 'clubs'));
    // Seat 0 won the round, so it is their turn again: the old card id is gone.
    expect(code(() => m.play(0, id))).toBe('INVALID_MOVE');
    expect(code(() => m.play(0, 'h9s9c9'))).toBe('INVALID_MOVE');
  });

  it('gives the round to the best card and lets its owner start the next round', () => {
    const m = newMatch();
    m.deal();
    play(m, 0, c('5', 'clubs'));
    play(m, 1, c('K', 'clubs'));
    play(m, 2, c('4', 'hearts'));
    const out = play(m, 3, c('Q', 'clubs'));
    expect(out[1]).toEqual({
      event: 'truco:round_ended',
      payload: { round: 1, result: 1, winningSeat: 1 },
    });
    expect(m.publicView()!.turn).toBe(1);
  });

  it('wins the hand with two rounds and scores its value', () => {
    const m = newMatch();
    m.deal();
    play(m, 0, c('3', 'clubs'));
    play(m, 1, c('K', 'clubs'));
    play(m, 2, c('4', 'hearts'));
    play(m, 3, c('Q', 'clubs'));
    play(m, 0, c('2', 'clubs'));
    play(m, 1, c('K', 'hearts'));
    play(m, 2, c('5', 'hearts'));
    const out = play(m, 3, c('Q', 'hearts'));
    expect(events(out)).toEqual([
      'truco:card_played',
      'truco:round_ended',
      'truco:hand_ended',
      'truco:score_updated',
    ]);
    expect(m.scores).toEqual([2, 0]);
    expect(m.phase).toBe('HAND_OVER');
    expect(m.publicView()!.lastHandResult).toEqual({
      winnerTeam: 0,
      points: 2,
      reason: 'rounds',
    });
    expect(code(() => play(m, 0, c('5', 'clubs')))).toBe('INVALID_STATE');
  });

  it('rotates the dealer every hand', () => {
    const m = newMatch();
    m.deal();
    expect(code(() => m.deal())).toBe('INVALID_STATE');
    m.requestBet(0);
    m.respondBet(1, 'run');
    m.deal();
    expect(m.publicView()!.dealer).toBe(0);
    expect(m.publicView()!.turn).toBe(1);
  });
});

describe('TrucoMatch — ties', () => {
  const TIE_FIRST: TrucoCard[][] = [
    [c('3', 'clubs'), c('2', 'clubs'), c('5', 'clubs')],
    [c('3', 'hearts'), c('K', 'hearts'), c('6', 'clubs')],
    [c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts')],
    [c('Q', 'clubs'), c('Q', 'hearts'), c('6', 'spades')],
  ];

  it('ties a round when opposing teams share the best card; the first of them starts next', () => {
    const m = newMatch([TIE_FIRST]);
    m.deal();
    play(m, 0, c('3', 'clubs'));
    play(m, 1, c('3', 'hearts'));
    play(m, 2, c('4', 'hearts'));
    const out = play(m, 3, c('Q', 'clubs'));
    expect(out[1].payload).toEqual({ round: 1, result: 'tie', winningSeat: 0 });
    expect(m.publicView()!.turn).toBe(0);
  });

  it('after a tied first round, the second round decides the hand', () => {
    const m = newMatch([TIE_FIRST]);
    m.deal();
    play(m, 0, c('3', 'clubs'));
    play(m, 1, c('3', 'hearts'));
    play(m, 2, c('4', 'hearts'));
    play(m, 3, c('Q', 'clubs'));
    play(m, 0, c('5', 'clubs'));
    play(m, 1, c('K', 'hearts'));
    play(m, 2, c('5', 'hearts'));
    const out = play(m, 3, c('Q', 'hearts'));
    expect(events(out)).toContain('truco:hand_ended');
    expect(m.scores).toEqual([0, 2]);
  });

  it('a tie between partners still wins the round for their team', () => {
    const m = newMatch([
      [
        [c('3', 'clubs'), c('2', 'clubs'), c('5', 'clubs')],
        [c('K', 'clubs'), c('K', 'hearts'), c('6', 'clubs')],
        [c('3', 'hearts'), c('5', 'hearts'), c('6', 'hearts')],
        [c('Q', 'clubs'), c('Q', 'hearts'), c('6', 'spades')],
      ],
    ]);
    m.deal();
    play(m, 0, c('3', 'clubs'));
    play(m, 1, c('K', 'clubs'));
    play(m, 2, c('3', 'hearts'));
    const out = play(m, 3, c('Q', 'clubs'));
    expect(out[1].payload).toMatchObject({ result: 0, winningSeat: 0 });
  });

  it('voids the hand when all three rounds tie', () => {
    const m = newMatch([
      [
        [c('3', 'clubs'), c('2', 'clubs'), c('K', 'clubs')],
        [c('3', 'hearts'), c('2', 'hearts'), c('K', 'hearts')],
        [c('4', 'hearts'), c('5', 'hearts'), c('6', 'hearts')],
        [c('5', 'clubs'), c('6', 'clubs'), c('Q', 'clubs')],
      ],
    ]);
    m.deal();
    for (const [a, b] of [
      [c('3', 'clubs'), c('3', 'hearts')],
      [c('2', 'clubs'), c('2', 'hearts')],
      [c('K', 'clubs'), c('K', 'hearts')],
    ]) {
      const s2 = m.privateView(2)!.cards[0].card!;
      const s3 = m.privateView(3)!.cards[0].card!;
      play(m, 0, a);
      play(m, 1, b);
      play(m, 2, s2);
      play(m, 3, s3);
    }
    expect(m.publicView()!.lastHandResult).toEqual({
      winnerTeam: null,
      points: 0,
      reason: 'void',
    });
    expect(m.scores).toEqual([0, 0]);
  });
});

describe('TrucoMatch — bets', () => {
  it('truco → accept raises the hand to 4 and play continues with the same player', () => {
    const m = newMatch();
    m.deal();
    expect(m.requestBet(0)).toEqual([
      {
        event: 'truco:bet_requested',
        payload: { seat: 0, team: 0, value: 4 },
      },
    ]);
    expect(m.phase).toBe('AWAITING_BET_RESPONSE');
    expect(code(() => play(m, 0, c('3', 'clubs')))).toBe('INVALID_STATE');
    expect(code(() => m.respondBet(2, 'accept'))).toBe('INVALID_MOVE');
    m.respondBet(3, 'accept');
    const view = m.publicView()!;
    expect(view.value).toBe(4);
    expect(view.pendingBet).toBeNull();
    expect(view.lastRaiseTeam).toBe(0);
    expect(view.turn).toBe(0);
  });

  it('only allows a request on your turn and not twice in a row by the same team', () => {
    const m = newMatch();
    m.deal();
    expect(code(() => m.requestBet(1))).toBe('NOT_YOUR_TURN');
    m.requestBet(0);
    m.respondBet(1, 'accept');
    play(m, 0, c('5', 'clubs'));
    play(m, 1, c('6', 'clubs'));
    expect(code(() => m.requestBet(2))).toBe('INVALID_MOVE');
    play(m, 2, c('6', 'hearts'));
    expect(m.requestBet(3)[0].payload).toMatchObject({ value: 6 });
  });

  it('running from a bet gives the requesting team the previous value', () => {
    const m = newMatch();
    m.deal();
    m.requestBet(0);
    m.respondBet(1, 'raise'); // team 1 asks for 6, accepting 4
    const out = m.respondBet(2, 'run');
    expect(out[0]).toEqual({
      event: 'truco:bet_resolved',
      payload: { seat: 2, response: 'run', value: 4 },
    });
    expect(m.scores).toEqual([0, 4]);
    expect(m.publicView()!.lastHandResult!.reason).toBe('bet_declined');
  });

  it('runs straight away from truco for 2 tentos', () => {
    const m = newMatch();
    m.deal();
    m.requestBet(0);
    m.respondBet(1, 'run');
    expect(m.scores).toEqual([2, 0]);
  });

  it('climbs the ladder 4 → 6 → 10 → 12 and stops at 12', () => {
    const m = newMatch();
    m.deal();
    m.requestBet(0);
    expect(m.respondBet(1, 'raise')[0].payload).toMatchObject({
      value: 6,
      team: 1,
    });
    expect(m.respondBet(2, 'raise')[0].payload).toMatchObject({ value: 10 });
    expect(m.respondBet(3, 'raise')[0].payload).toMatchObject({ value: 12 });
    expect(code(() => m.respondBet(0, 'raise'))).toBe('INVALID_MOVE');
    // The rejected raise did not change the hand.
    expect(m.publicView()!.value).toBe(10);
    m.respondBet(0, 'accept');
    expect(m.publicView()!.value).toBe(12);
    expect(code(() => m.requestBet(0))).toBe('INVALID_MOVE');
  });

  it('pays the accepted value to the hand winner', () => {
    const m = newMatch();
    m.deal();
    m.requestBet(0);
    m.respondBet(1, 'accept');
    play(m, 0, c('3', 'clubs'));
    play(m, 1, c('K', 'clubs'));
    play(m, 2, c('4', 'hearts'));
    play(m, 3, c('Q', 'clubs'));
    play(m, 0, c('2', 'clubs'));
    play(m, 1, c('K', 'hearts'));
    play(m, 2, c('5', 'hearts'));
    play(m, 3, c('Q', 'hearts'));
    expect(m.scores).toEqual([4, 0]);
  });
});

describe('TrucoMatch — mão de dez and mão de ferro', () => {
  it('mão de dez: the team at 10 sees the partner cards and decides', () => {
    const m = newMatch([HAND_A], { scores: [10, 4] });
    expect(m.deal()[0].payload).toEqual({
      handNumber: 1,
      kind: 'ten',
      tenTeam: 0,
    });
    expect(m.phase).toBe('AWAITING_TEN_DECISION');
    expect(m.privateView(0)!.partnerCards).toEqual(HAND_A[2]);
    expect(m.privateView(2)!.partnerCards).toEqual(HAND_A[0]);
    expect(m.privateView(1)!.partnerCards).toBeNull();
    expect(code(() => play(m, 0, c('3', 'clubs')))).toBe('INVALID_STATE');
    expect(code(() => m.decideTen(1, true))).toBe('INVALID_MOVE');

    m.decideTen(2, true);
    expect(m.privateView(0)!.partnerCards).toBeNull();
    expect(m.publicView()!.value).toBe(4);
    expect(code(() => m.requestBet(0))).toBe('INVALID_MOVE');
  });

  it('mão de dez accepted and won ends the match at 12', () => {
    const m = newMatch([HAND_A], { scores: [10, 4] });
    m.deal();
    m.decideTen(0, true);
    play(m, 0, c('3', 'clubs'));
    play(m, 1, c('K', 'clubs'));
    play(m, 2, c('4', 'hearts'));
    play(m, 3, c('Q', 'clubs'));
    play(m, 0, c('2', 'clubs'));
    play(m, 1, c('K', 'hearts'));
    play(m, 2, c('5', 'hearts'));
    const out = play(m, 3, c('Q', 'hearts'));
    expect(m.scores).toEqual([12, 4]);
    expect(m.winner).toBe(0);
    expect(out[out.length - 1]).toEqual({
      event: 'truco:match_over',
      payload: { winnerTeam: 0, reason: 'points', scores: [12, 4] },
    });
    expect(code(() => m.deal())).toBe('INVALID_STATE');
  });

  it('mão de dez declined gives 2 tentos to the opponents', () => {
    const m = newMatch([HAND_A], { scores: [4, 10] });
    m.deal();
    const out = m.decideTen(3, false);
    expect(events(out)).toEqual([
      'truco:ten_decided',
      'truco:hand_ended',
      'truco:score_updated',
    ]);
    expect(m.scores).toEqual([6, 10]);
  });

  it('mão de ferro (10 x 10): cards are blind until played, no truco, worth 2', () => {
    const m = newMatch([HAND_A], { scores: [10, 10] });
    expect(m.deal()[0].payload).toMatchObject({ kind: 'iron', tenTeam: null });
    for (const seat of [0, 1, 2, 3] as const) {
      const hand = m.privateView(seat)!;
      expect(hand.cards).toHaveLength(3);
      expect(hand.cards.every((h) => h.card === null)).toBe(true);
      expect(hand.partnerCards).toBeNull();
    }
    expect(m.phase).toBe('AWAITING_PLAY');
    expect(m.publicView()!.value).toBe(2);
    expect(code(() => m.requestBet(0))).toBe('INVALID_MOVE');

    const out = m.play(0, m.privateView(0)!.cards[0].id);
    expect(out[0]).toEqual({
      event: 'truco:card_played',
      payload: { seat: 0, card: HAND_A[0][0], round: 1 },
    });
    expect(m.publicView()!.rounds[0].plays[0].card).toEqual(HAND_A[0][0]);
  });

  it('a mão de ferro win ends the match', () => {
    const m = newMatch([HAND_A], { scores: [10, 10] });
    m.deal();
    for (let round = 0; round < 2; round++)
      for (const seat of [0, 1, 2, 3] as const)
        m.play(seat, m.privateView(seat)!.cards[0].id);
    expect(m.winner).toBe(0);
    expect(m.scores).toEqual([12, 10]);
  });
});

describe('TrucoMatch — abandon', () => {
  it('gives the walkover to the other team once', () => {
    const m = newMatch();
    m.deal();
    expect(m.abandon(1)).toEqual([
      {
        event: 'truco:match_over',
        payload: { winnerTeam: 0, reason: 'abandoned', scores: [0, 0] },
      },
    ]);
    expect(m.winner).toBe(0);
    expect(m.abandon(0)).toEqual([]);
    expect(code(() => play(m, 0, c('3', 'clubs')))).toBe('INVALID_STATE');
  });

  it('has no views before the first deal', () => {
    const m = new TrucoMatch(() => 2);
    expect(m.publicView()).toBeNull();
    expect(m.privateView(0)).toBeNull();
    expect(m.phase).toBe('DEALING');
    expect(code(() => m.requestBet(0))).toBe('INVALID_STATE');
  });
});
