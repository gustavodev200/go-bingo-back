import {
  BJ_BET_SECONDS,
  BJ_DEALER_CARD_MS,
  BJ_INSURANCE_SECONDS,
  BJ_SETTLE_PAUSE_MS,
  DEFAULT_BJ_RULES,
  bjTotal,
  isBlackjack,
  type BjCard,
  type BjRules,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { BjMatch, type Announcement } from './match';
import { Shoe, fullShoe } from './shoe';

const firstRandom = (min: number) => min;
const NAMES = ['Ana', 'Bia', 'Caio', 'Duda', 'Edu'];

function match(
  stack: BjCard[],
  seats: number[] = [0],
  rules: Partial<BjRules> = {},
) {
  return new BjMatch(
    firstRandom,
    seats,
    { ...DEFAULT_BJ_RULES, ...rules },
    (s) => NAMES[s],
    (s) => `u${s}`,
    stack,
  );
}

const events = (out: Announcement[]) => out.map((a) => a.event);
const player = (m: BjMatch, seat = 0) => m.publicView().players[seat]!;
const expectDomain = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error('expected a DomainError');
};

describe('card totals', () => {
  it('counts an ace as 11 while it does not bust', () => {
    expect(bjTotal(['AS', '6H'])).toEqual({ total: 17, soft: true });
    expect(bjTotal(['AS', '6H', 'TD'])).toEqual({ total: 17, soft: false });
    expect(bjTotal(['AS', 'AH', '9D'])).toEqual({ total: 21, soft: true });
    expect(bjTotal(['KS', 'QH', '2D'])).toEqual({ total: 22, soft: false });
  });

  it('knows a natural blackjack', () => {
    expect(isBlackjack(['AS', 'JH'])).toBe(true);
    expect(isBlackjack(['7S', '7H', '7D'])).toBe(false);
  });
});

describe('Shoe', () => {
  it('holds 52 cards per deck', () => {
    expect(fullShoe(2)).toHaveLength(104);
    expect(new Shoe(6, firstRandom).size).toBe(312);
  });

  it('deals the stacked cards first and refills without the cards in play', () => {
    const shoe = new Shoe(1, firstRandom, ['AS']);
    expect(shoe.draw(() => []).card).toBe('AS');
    shoe.refill(['KH', 'QD']);
    expect(shoe.size).toBe(50);
    const seen: BjCard[] = [];
    for (let i = 0; i < 50; i++) seen.push(shoe.draw(() => []).card);
    expect(seen).not.toContain('KH');
    const next = shoe.draw(() => ['AS']);
    expect(next.shuffled).toBe(true);
    expect(shoe.size).toBe(51);
  });
});

describe('BjMatch — one round', () => {
  // Deal order: each player, dealer up card, each player, dealer hole card.
  it('starts in betting and deals once everybody bet', () => {
    const m = match(['TS', '9H', 'QD', '7C', '6D']);
    expect(m.stage).toBe('BETTING');
    expect(m.stageMs).toBe(BJ_BET_SECONDS * 1000);
    const out = m.bet(0, 100);
    expect(events(out)).toEqual(['blackjack:dealt']);
    expect(m.stage).toBe('PLAYING');
    const view = m.publicView();
    expect(view.dealer.cards).toEqual(['9H', null]);
    expect(view.dealer.total).toBe(9);
    expect(view.players[0]!.hands[0]).toMatchObject({
      cards: ['TS', 'QD'],
      total: 20,
      bet: 100,
    });
    expect(view.players[0]!.chips).toBe(900);
    expect(view.turn).toEqual({ seat: 0, hand: 0 });
    expect(view.actions).toEqual([
      'hit',
      'stand',
      'double',
      'split',
      'surrender',
    ]);
  });

  it('pays 1:1 when the dealer busts', () => {
    const m = match(['TS', '9H', 'QD', '7C', '6D']);
    m.bet(0, 100);
    const out = m.act(0, 'stand');
    expect(events(out)).toEqual([
      'blackjack:acted',
      'blackjack:dealer_played',
      'blackjack:round_settled',
    ]);
    expect(m.stage).toBe('SETTLED');
    expect(m.publicView().dealer.cards).toEqual(['9H', '7C', '6D']);
    expect(player(m).hands[0]).toMatchObject({ outcome: 'win', net: 100 });
    expect(player(m).chips).toBe(1100);
    expect(m.stageMs).toBe(BJ_SETTLE_PAUSE_MS + BJ_DEALER_CARD_MS);
  });

  it('loses to a better dealer total and pushes on a tie', () => {
    const lose = match(['TS', '9H', '8D', '7C', '5D']);
    lose.bet(0, 100);
    lose.act(0, 'stand');
    expect(player(lose).hands[0].outcome).toBe('lose');
    expect(player(lose).chips).toBe(900);

    const push = match(['TS', '9H', 'QD', 'AC']);
    push.bet(0, 100);
    push.act(0, 'stand');
    expect(player(push).hands[0].outcome).toBe('push');
    expect(player(push).chips).toBe(1000);
  });

  it('pays a natural 3:2 or 6:5 and the dealer does not draw', () => {
    const m = match(['AS', '9H', 'KD', '7C']);
    const out = m.bet(0, 100);
    expect(out[0]).toMatchObject({ payload: { blackjacks: [0] } });
    expect(m.stage).toBe('SETTLED');
    expect(m.publicView().dealer.cards).toEqual(['9H', '7C']);
    expect(player(m).hands[0]).toMatchObject({
      status: 'blackjack',
      outcome: 'blackjack',
      net: 150,
    });
    const low = match(['AS', '9H', 'KD', '7C'], [0], { payout: '6:5' });
    low.bet(0, 100);
    expect(player(low).chips).toBe(1120);
  });

  it('busts over 21 and stops by itself on 21', () => {
    const bust = match(['TS', '9H', '6D', '7C', 'KH']);
    bust.bet(0, 100);
    const out = bust.act(0, 'hit');
    expect(out[0]).toMatchObject({
      event: 'blackjack:acted',
      payload: { status: 'bust', total: 26 },
    });
    expect(bust.publicView().dealer.cards).toEqual(['9H', '7C']);
    expect(player(bust).chips).toBe(900);

    const auto = match(['TS', '9H', '6D', '7C', '5H', '2S']);
    auto.bet(0, 100);
    auto.act(0, 'hit');
    expect(player(auto).hands[0].status).toBe('stood');
    expect(auto.stage).toBe('SETTLED');
  });

  it('doubles for exactly one card', () => {
    const m = match(['6S', '9H', '5D', '7C', 'TH', '2C']);
    m.bet(0, 100);
    m.act(0, 'double');
    expect(player(m).hands[0]).toMatchObject({
      status: 'doubled',
      bet: 200,
      total: 21,
      outcome: 'win',
      net: 200,
    });
    expect(player(m).chips).toBe(1200);
  });

  it('splits a pair once, each hand with its own bet', () => {
    // 8-8 vs 6: split, 8+3 doubles to 20, 8+T stands; dealer 16 draws K and busts.
    const m = match(['8S', '6C', '8H', 'TD', '3D', 'TC', '9S', 'KH']);
    m.bet(0, 100);
    m.act(0, 'split');
    let view = m.publicView();
    expect(view.players[0]!.hands.map((h) => h.cards)).toEqual([
      ['8S', '3D'],
      ['8H', 'TC'],
    ]);
    expect(view.players[0]!.chips).toBe(800);
    expect(view.actions).not.toContain('split');
    expect(view.actions).not.toContain('surrender');
    m.act(0, 'double');
    view = m.publicView();
    expect(view.turn).toEqual({ seat: 0, hand: 1 });
    m.act(0, 'stand');
    expect(player(m).hands.map((h) => h.net)).toEqual([200, 100]);
    expect(player(m).chips).toBe(1300);
  });

  it('gives split aces one card each, and 21 there is not a blackjack', () => {
    const m = match(['AS', '5C', 'AH', '9D', 'KS', '2H', 'TD']);
    m.bet(0, 100);
    m.act(0, 'split');
    expect(player(m).hands.map((h) => h.status)).toEqual(['stood', 'stood']);
    expect(m.stage).toBe('SETTLED');
    expect(player(m).hands[0]).toMatchObject({
      total: 21,
      outcome: 'win',
      net: 100,
    });
    expect(player(m).hands[1]).toMatchObject({ total: 13, outcome: 'win' });
  });

  it('surrenders for half the bet, only with the 6-deck shoe', () => {
    const m = match(['TS', '9H', '6D', '7C']);
    m.bet(0, 100);
    m.act(0, 'surrender');
    expect(player(m).hands[0]).toMatchObject({
      outcome: 'surrender',
      net: -50,
    });
    expect(player(m).chips).toBe(950);

    const two = match(['TS', '9H', '6D', '7C'], [0], { decks: 2 });
    two.bet(0, 100);
    expect(two.publicView().actions).not.toContain('surrender');
    expectDomain(() => two.act(0, 'surrender'), 'INVALID_MOVE');
  });

  it('offers insurance on an ace and pays it 2:1 against a blackjack', () => {
    const m = match(['TS', 'AH', '9D', 'KC']);
    const out = m.bet(0, 100);
    expect(out[0]).toMatchObject({ payload: { insurance: true } });
    expect(m.stage).toBe('INSURANCE');
    expect(m.stageMs).toBe(BJ_INSURANCE_SECONDS * 1000);
    m.insurance(0, true);
    expect(m.stage).toBe('SETTLED');
    expect(m.publicView().dealer.blackjack).toBe(true);
    expect(player(m)).toMatchObject({
      insuranceNet: 100,
      roundNet: 0,
      chips: 1000,
    });
  });

  it('loses the insurance when the dealer has no blackjack and play goes on', () => {
    const m = match(['TS', 'AH', '9D', '6C', '2H']);
    m.bet(0, 100);
    m.insurance(0, true);
    expect(m.stage).toBe('PLAYING');
    expect(player(m).chips).toBe(850);
    m.act(0, 'stand');
    // Dealer A+6 is a soft 17 and stands: 19 wins 100, the insurance lost 50.
    expect(player(m)).toMatchObject({ insuranceNet: -50, roundNet: 50 });
  });

  it('peeks with a ten up: a dealer blackjack ends the round at once', () => {
    const m = match(['TS', 'KH', '9D', 'AC']);
    m.bet(0, 100);
    expect(m.stage).toBe('SETTLED');
    expect(player(m).hands[0].outcome).toBe('lose');
    const both = match(['AS', 'KH', 'QD', 'AC']);
    both.bet(0, 100);
    expect(player(both).hands[0].outcome).toBe('push');
  });

  it('stands on soft 17', () => {
    const m = match(['TS', 'AH', '8D', '6C']);
    m.bet(0, 100);
    m.insurance(0, false);
    m.act(0, 'stand');
    expect(m.publicView().dealer.cards).toEqual(['AH', '6C']);
    expect(player(m).hands[0].outcome).toBe('win');
  });

  it('rejects invalid actions', () => {
    const m = match(['TS', '9H', 'QD', '7C'], [0, 1]);
    expectDomain(() => m.bet(0, 15), 'INVALID_MOVE');
    expectDomain(() => m.bet(0, 600), 'INVALID_MOVE');
    expectDomain(() => m.act(0, 'hit'), 'INVALID_STATE');
    m.bet(0, 100);
    expectDomain(() => m.bet(0, 100), 'INVALID_MOVE');
    expectDomain(() => m.insurance(0, true), 'INVALID_STATE');
    expectDomain(() => m.bet(7, 100), 'INVALID_MOVE');
  });
});

describe('BjMatch — clock and tournament', () => {
  it('bets the minimum for whoever did not bet and stands on a timeout', () => {
    const m = match(['TS', '9H', 'QD', '7C', '5D', '6S', '4C'], [0, 1]);
    m.bet(0, 100);
    expect(m.stage).toBe('BETTING');
    m.timeout();
    expect(player(m, 1).bet).toBe(10);
    expect(m.publicView().turn).toEqual({ seat: 0, hand: 0 });
    const out = m.timeout();
    expect(out[0]).toMatchObject({
      event: 'blackjack:acted',
      payload: { action: 'stand', auto: true },
    });
    expect(m.publicView().turn?.seat).toBe(1);
  });

  it('plays seats in order and ranks by chips at the end', () => {
    // a: T,Q=20 · b: 5,6=11 · dealer 9 up, 7 hole. b doubles with 9 → 20. dealer draws 2 → 18.
    const m = match(['TS', '5H', '9H', 'QD', '6C', '7C', '9S', '2D'], [3, 1], {
      rounds: 5,
    });
    m.bet(1, 100);
    m.bet(3, 50);
    expect(m.publicView().turn?.seat).toBe(1);
    m.act(1, 'stand');
    m.act(3, 'double');
    expect(player(m, 1).chips).toBe(1100);
    expect(player(m, 3).chips).toBe(1100);
    expect(m.round).toBe(1);
    const out = m.timeout();
    expect(events(out)).toEqual(['blackjack:round_started']);
    expect(m.round).toBe(2);
    expect(m.stage).toBe('BETTING');
  });

  it('ends after the last round with tied places shared', () => {
    const m = match(['TS', 'TH', '9H', 'QD', 'QC', '7C'], [0, 1], {
      rounds: 5,
    });
    for (let r = 1; r <= 5; r++) {
      if (m.stage === 'BETTING') m.timeout();
      while (m.stage !== 'SETTLED') m.timeout();
      if (r < 5) m.timeout();
    }
    const out = m.timeout();
    expect(events(out)).toContain('blackjack:match_over');
    expect(m.phase).toBe('OVER');
    expect(m.result!.reason).toBe('rounds');
    expect(m.result!.standings).toHaveLength(2);
    const placements = m.result!.standings.map((s) => s.placement);
    expect(placements[0]).toBe(1);
    const top = m.result!.standings[0];
    expect(top.nickname).toBe(NAMES[top.seat]);
    expect(top.userId).toBe(`u${top.seat}`);
  });

  it('lets the player bet what is left, but never more', () => {
    const m = match(['TS', '9H', '6D', '7C', 'KH']);
    m.bet(0, 500);
    m.act(0, 'hit');
    m.timeout();
    expect(player(m).chips).toBe(500);
    m.bet(0, 500);
    expect(player(m).chips).toBe(0);
    expect(m.publicView().actions).toEqual(['hit', 'stand', 'surrender']);
  });

  it('marks a player broke below the minimum bet', () => {
    const m = match([
      'TS',
      '9H',
      '6D',
      '7C',
      'KH',
      'TC',
      '9D',
      '6H',
      '7S',
      'KD',
    ]);
    m.bet(0, 500);
    m.act(0, 'hit');
    m.timeout();
    m.bet(0, 500);
    m.act(0, 'hit');
    expect(player(m).chips).toBe(0);
    const out = m.timeout();
    expect(events(out)).toEqual([
      'blackjack:player_broke',
      'blackjack:match_over',
    ]);
    expect(m.result!.reason).toBe('broke');
  });

  it('ends a multiplayer match when only one player is left, refunding the table', () => {
    const m = match(['TS', '9H', '9H', 'QD', '7C', '7C'], [0, 1]);
    m.bet(0, 100);
    m.removePlayer(1);
    expect(m.phase).toBe('OVER');
    expect(m.result!.reason).toBe('abandoned');
    expect(m.result!.standings).toEqual([
      expect.objectContaining({
        seat: 0,
        placement: 1,
        chips: 1000,
        left: false,
      }),
      expect.objectContaining({ seat: 1, placement: 2, left: true }),
    ]);
  });

  it('moves the turn on when the player on turn leaves a solo-started table', () => {
    const m = match(['TS', '9H', '9H', 'QD', '7C', '7C', '5D'], [0, 1, 2]);
    m.timeout();
    expect(m.publicView().turn?.seat).toBe(0);
    m.removePlayer(0);
    expect(m.publicView().turn?.seat).toBe(1);
    expect(player(m, 0).left).toBe(true);
    m.removePlayer(1);
    expect(m.phase).toBe('OVER');
  });

  it('keeps going in betting once the missing player leaves', () => {
    const m = match(['TS', '9H', '9H', 'QD', '7C', '7C'], [0, 1, 2]);
    m.bet(0, 100);
    m.bet(1, 100);
    m.removePlayer(2);
    expect(m.stage).toBe('PLAYING');
  });

  it('a solo practice match ends when the player leaves', () => {
    const m = match(['TS', '9H', 'QD', '7C']);
    m.removePlayer(0);
    expect(m.phase).toBe('OVER');
    expect(m.timeout()).toEqual([]);
  });
});
