import {
  DEFAULT_UNO_RULES,
  type UnoCard,
  type UnoRules,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { type Announcement, UnoMatch } from './match';
import { card, cards } from './test-cards';

const FILL = card('y8');
const PAD = card('b9');
/** Deterministic shuffle: random(min, max) always returns min. */
const random = (min: number) => min;

interface Setup {
  hands: UnoCard[][];
  top?: UnoCard | UnoCard[];
  rest?: UnoCard[];
  seats?: number[];
  rules?: Partial<UnoRules>;
  starter?: number;
  handSize?: number;
  /** Pad the draw pile with harmless cards (on by default). */
  pad?: boolean;
  scores?: number[];
}

/** Hands are dealt in seat order (padded with yellow 8s), then the top card, then the draw pile. */
function setup(opts: Setup) {
  const seats = opts.seats ?? [0, 1, 2];
  const handSize = opts.handSize ?? 7;
  const deck: UnoCard[] = [];
  seats.forEach((_, i) => {
    const hand = opts.hands[i] ?? [];
    deck.push(...hand, ...Array<UnoCard>(handSize - hand.length).fill(FILL));
  });
  deck.push(...[opts.top ?? card('r5')].flat(), ...(opts.rest ?? []));
  if (opts.pad !== false) deck.push(...Array<UnoCard>(30).fill(PAD));
  const match = new UnoMatch(
    random,
    seats,
    { ...DEFAULT_UNO_RULES, ...opts.rules },
    {
      deck: () => deck.map((c) => ({ ...c })),
      starter: opts.starter ?? 0,
      handSize,
      scores: opts.scores,
    },
  );
  const started = match.startRound();
  return { match, started };
}

const view = (m: UnoMatch) => m.publicView();
const hand = (m: UnoMatch, seat: number) => m.privateView(seat)!;
/** Id of the first card in `seat`'s hand matching `code`. */
function idOf(m: UnoMatch, seat: number, code: string): string {
  const target = card(code);
  const found = hand(m, seat).cards.find(
    (c) => c.card.color === target.color && c.card.value === target.value,
  );
  if (!found) throw new Error(`seat ${seat} has no ${code}`);
  return found.id;
}
const events = (out: Announcement[]) => out.map((a) => a.event);
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return undefined;
}

describe('UnoMatch — dealing', () => {
  it('deals 7 cards per player, turns the top card and starts with the starter', () => {
    const { match, started } = setup({ hands: [] });
    const v = view(match);
    expect(v.handCounts).toEqual([7, 7, 7, 0, 0, 0]);
    expect(v.topCard).toEqual(card('r5'));
    expect(v.color).toBe('red');
    expect(v.turn).toBe(0);
    expect(v.direction).toBe(1);
    expect(events(started)).toEqual(['uno:round_started']);
    const ids = [0, 1, 2].flatMap((s) => hand(match, s).cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(21);
    expect(ids.join()).not.toMatch(/red|yellow|blue|green|wild/);
  });

  it('puts a wild first card back and turns another one', () => {
    const { match } = setup({ hands: [], top: cards('w+4', 'w', 'g3') });
    expect(view(match).topCard).toEqual(card('g3'));
  });

  it('skips the first player when the first card is a skip', () => {
    const { match, started } = setup({ hands: [], top: card('gS') });
    expect(view(match).turn).toBe(1);
    expect(started).toContainEqual({
      event: 'uno:turn_skipped',
      payload: { seat: 0 },
    });
  });

  it('makes the first player draw 2 and lose the turn on a +2', () => {
    const { match } = setup({ hands: [], top: card('g+2') });
    expect(view(match).handCounts[0]).toBe(9);
    expect(view(match).turn).toBe(1);
  });

  it('reverses on a first reverse (skip with two players)', () => {
    const three = setup({ hands: [], top: card('gR') }).match;
    expect(view(three).direction).toBe(-1);
    expect(view(three).turn).toBe(2);
    const two = setup({ hands: [], top: card('gR'), seats: [0, 1] }).match;
    expect(view(two).turn).toBe(1);
  });
});

describe('UnoMatch — playing', () => {
  it('rejects moves out of turn, unplayable cards and wilds without a color', () => {
    const { match } = setup({ hands: [cards('b6', 'w'), cards('r3')] });
    expect(codeOf(() => match.play(1, idOf(match, 1, 'r3'), {}))).toBe(
      'NOT_YOUR_TURN',
    );
    expect(codeOf(() => match.play(0, idOf(match, 0, 'b6'), {}))).toBe(
      'INVALID_MOVE',
    );
    expect(codeOf(() => match.play(0, idOf(match, 0, 'w'), {}))).toBe(
      'INVALID_MOVE',
    );
    expect(codeOf(() => match.play(0, 'nope', {}))).toBe('INVALID_MOVE');
    expect(view(match).handCounts[0]).toBe(7);
    expect(view(match).turn).toBe(0);
  });

  it('plays a number and passes the turn', () => {
    const { match } = setup({ hands: [cards('r3')] });
    const out = match.play(0, idOf(match, 0, 'r3'), {});
    expect(out[0]).toEqual({
      event: 'uno:card_played',
      payload: { seat: 0, card: card('r3'), color: 'red', cardsLeft: 6 },
    });
    expect(view(match).turn).toBe(1);
    expect(view(match).topCard).toEqual(card('r3'));
  });

  it('lists only playable cards to the turn player', () => {
    const { match } = setup({ hands: [cards('r3', 'b6')] });
    expect(hand(match, 0).playable).toEqual([idOf(match, 0, 'r3')]);
    expect(hand(match, 1).playable).toEqual([]);
  });

  it('changes the color with a wild card', () => {
    const { match } = setup({ hands: [cards('w')] });
    match.play(0, idOf(match, 0, 'w'), { color: 'green' });
    expect(view(match).color).toBe('green');
  });

  it('skips the next player', () => {
    const { match } = setup({ hands: [cards('rS')] });
    const out = match.play(0, idOf(match, 0, 'rS'), {});
    expect(view(match).turn).toBe(2);
    expect(events(out)).toContain('uno:turn_skipped');
  });

  it('reverses the direction (a skip with two players)', () => {
    const three = setup({ hands: [cards('rR')] }).match;
    three.play(0, idOf(three, 0, 'rR'), {});
    expect(view(three).direction).toBe(-1);
    expect(view(three).turn).toBe(2);
    const two = setup({ hands: [cards('rR')], seats: [0, 1] }).match;
    two.play(0, idOf(two, 0, 'rR'), {});
    expect(view(two).turn).toBe(0);
  });

  it('makes the next player draw 2 and lose the turn on a +2', () => {
    const { match } = setup({ hands: [cards('r+2')] });
    const out = match.play(0, idOf(match, 0, 'r+2'), {});
    expect(view(match).handCounts[1]).toBe(9);
    expect(view(match).turn).toBe(2);
    expect(out).toContainEqual({
      event: 'uno:cards_drawn',
      payload: { seat: 1, count: 2, reason: 'penalty' },
    });
  });

  it('refuses any action after the round is over', () => {
    const { match } = setup({ hands: [cards('r3')], handSize: 1 });
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(codeOf(() => match.draw(1))).toBe('INVALID_STATE');
  });
});

describe('UnoMatch — drawing', () => {
  it('keeps the turn when the drawn card is playable, then plays or passes it', () => {
    const { match } = setup({ hands: [cards('b3')], rest: cards('r9') });
    match.draw(0);
    const drawnId = hand(match, 0).drawnCardId!;
    expect(view(match).awaitingDrawn).toBe(true);
    expect(view(match).turn).toBe(0);
    expect(hand(match, 0).playable).toEqual([drawnId]);
    expect(codeOf(() => match.draw(0))).toBe('INVALID_MOVE');
    match.pass(0);
    expect(view(match).turn).toBe(1);
    expect(view(match).awaitingDrawn).toBe(false);
  });

  it('may play the drawn card right away', () => {
    const { match } = setup({ hands: [], rest: cards('r9') });
    match.draw(0);
    match.play(0, hand(match, 0).drawnCardId!, {});
    expect(view(match).topCard).toEqual(card('r9'));
    expect(view(match).turn).toBe(1);
  });

  it('passes the turn when the drawn card does not fit', () => {
    const { match } = setup({ hands: [], rest: cards('b2') });
    match.draw(0);
    expect(view(match).turn).toBe(1);
    expect(view(match).handCounts[0]).toBe(8);
  });

  it('does not pass without drawing first', () => {
    const { match } = setup({ hands: [] });
    expect(codeOf(() => match.pass(0))).toBe('INVALID_MOVE');
  });

  it('reshuffles the discard pile (except the top) when the draw pile is empty', () => {
    const { match } = setup({
      hands: [cards('r1', 'y1'), cards('b2', 'y2')],
      seats: [0, 1],
      handSize: 2,
      pad: false,
    });
    match.play(0, idOf(match, 0, 'r1'), {});
    expect(view(match).drawPile).toBe(0);
    match.draw(1);
    expect(view(match).handCounts[1]).toBe(3);
    expect(view(match).discardCount).toBe(1);
    expect(hand(match, 1).cards.map((c) => c.card)).toContainEqual(card('r5'));
  });

  it('passes the turn when there is nothing at all to draw', () => {
    const { match } = setup({
      hands: [cards('b1', 'b2'), cards('g2', 'g3')],
      seats: [0, 1],
      handSize: 2,
      pad: false,
    });
    const out = match.draw(0);
    expect(view(match).turn).toBe(1);
    expect(out).toContainEqual({
      event: 'uno:cards_drawn',
      payload: { seat: 0, count: 0, reason: 'choice' },
    });
  });
});

describe('UnoMatch — wild +4 and challenges', () => {
  it('lets the victim decline: draws 4 and loses the turn', () => {
    const { match } = setup({ hands: [cards('w+4')] });
    match.play(0, idOf(match, 0, 'w+4'), { color: 'blue' });
    expect(view(match).pendingDraw).toBe(4);
    expect(view(match).canChallenge).toBe(true);
    expect(view(match).turn).toBe(1);
    expect(hand(match, 1).playable).toEqual([]);
    match.draw(1);
    expect(view(match).handCounts[1]).toBe(11);
    expect(view(match).turn).toBe(2);
    expect(view(match).pendingDraw).toBe(0);
  });

  it('punishes a bluff: the player who had the color draws 4 instead', () => {
    const { match } = setup({ hands: [cards('w+4', 'r3')] });
    match.play(0, idOf(match, 0, 'w+4'), { color: 'blue' });
    const out = match.challenge(1);
    expect(out).toContainEqual({
      event: 'uno:challenge_resolved',
      payload: { challenger: 1, target: 0, bluffed: true },
    });
    expect(view(match).handCounts[0]).toBe(10);
    expect(view(match).handCounts[1]).toBe(7);
    expect(view(match).turn).toBe(1);
    expect(view(match).pendingDraw).toBe(0);
  });

  it('punishes a wrong challenge with 6 cards and the lost turn', () => {
    const { match } = setup({ hands: [cards('w+4')] });
    match.play(0, idOf(match, 0, 'w+4'), { color: 'blue' });
    match.challenge(1);
    expect(view(match).handCounts[1]).toBe(13);
    expect(view(match).turn).toBe(2);
  });

  it('has nothing to challenge without a +4', () => {
    const { match } = setup({ hands: [cards('r3')] });
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(codeOf(() => match.challenge(1))).toBe('INVALID_MOVE');
  });

  it('does not stack without the house rule', () => {
    const { match } = setup({ hands: [cards('w+4'), cards('w+4')] });
    match.play(0, idOf(match, 0, 'w+4'), { color: 'blue' });
    expect(
      codeOf(() => match.play(1, idOf(match, 1, 'w+4'), { color: 'red' })),
    ).toBe('INVALID_MOVE');
  });
});

describe('UnoMatch — UNO!', () => {
  const twoCards = () =>
    setup({
      hands: [cards('r3', 'r4'), cards('r6', 'b1'), cards('r7', 'b2')],
      handSize: 2,
    }).match;

  it('exposes a player left with one card who did not say UNO, and others can catch them', () => {
    const match = twoCards();
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(view(match).unoExposed).toBe(0);
    expect(codeOf(() => match.catchUno(0))).toBe('INVALID_MOVE');
    const out = match.catchUno(1);
    expect(out).toContainEqual({
      event: 'uno:uno_caught',
      payload: { seat: 0, by: 1 },
    });
    expect(view(match).handCounts[0]).toBe(3);
    expect(view(match).unoExposed).toBeNull();
  });

  it('protects a player who said UNO before playing', () => {
    const match = twoCards();
    match.callUno(0);
    expect(view(match).saidUno[0]).toBe(true);
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(view(match).unoExposed).toBeNull();
    expect(codeOf(() => match.catchUno(1))).toBe('INVALID_MOVE');
  });

  it('lets the exposed player still say UNO before being caught', () => {
    const match = twoCards();
    match.play(0, idOf(match, 0, 'r3'), {});
    match.callUno(0);
    expect(view(match).unoExposed).toBeNull();
    expect(codeOf(() => match.catchUno(1))).toBe('INVALID_MOVE');
  });

  it('closes the window once another player acts', () => {
    const match = twoCards();
    match.play(0, idOf(match, 0, 'r3'), {});
    match.callUno(1);
    match.play(1, idOf(match, 1, 'r6'), {});
    expect(view(match).unoExposed).toBeNull();
    expect(codeOf(() => match.catchUno(2))).toBe('INVALID_MOVE');
  });

  it('refuses UNO with more than two cards', () => {
    const { match } = setup({ hands: [] });
    expect(codeOf(() => match.callUno(0))).toBe('INVALID_MOVE');
  });
});

describe('UnoMatch — house rules', () => {
  it('stacks +2 on +2 and the victim draws the sum', () => {
    const { match } = setup({
      hands: [cards('r+2'), cards('b+2')],
      rules: { stacking: true },
    });
    match.play(0, idOf(match, 0, 'r+2'), {});
    expect(view(match).pendingDraw).toBe(2);
    expect(view(match).turn).toBe(1);
    match.play(1, idOf(match, 1, 'b+2'), {});
    expect(view(match).pendingDraw).toBe(4);
    match.draw(2);
    expect(view(match).handCounts[2]).toBe(11);
    expect(view(match).turn).toBe(0);
  });

  it('stacks +4 on +2 (no challenge on a stack)', () => {
    const { match } = setup({
      hands: [cards('r+2'), cards('w+4')],
      rules: { stacking: true },
    });
    match.play(0, idOf(match, 0, 'r+2'), {});
    match.play(1, idOf(match, 1, 'w+4'), { color: 'green' });
    expect(view(match).pendingDraw).toBe(6);
    expect(view(match).canChallenge).toBe(false);
  });

  it('swaps hands with the chosen player on a 7', () => {
    const { match } = setup({
      hands: [cards('r7', 'r1', 'r2'), [], cards('g1', 'g2', 'g3')],
      handSize: 3,
      rules: { sevenZero: true },
    });
    const seven = idOf(match, 0, 'r7');
    expect(codeOf(() => match.play(0, seven, {}))).toBe('INVALID_MOVE');
    expect(codeOf(() => match.play(0, seven, { target: 0 }))).toBe(
      'INVALID_MOVE',
    );
    expect(codeOf(() => match.play(0, seven, { target: 4 }))).toBe(
      'INVALID_MOVE',
    );
    const out = match.play(0, seven, { target: 2 });
    expect(events(out)).toContain('uno:hands_swapped');
    expect(hand(match, 0).cards.map((c) => c.card)).toEqual(
      cards('g1', 'g2', 'g3'),
    );
    expect(hand(match, 2).cards.map((c) => c.card)).toEqual(cards('r1', 'r2'));
  });

  it('rotates every hand along the direction on a 0', () => {
    const { match } = setup({
      hands: [
        cards('r0', 'r1', 'r2'),
        cards('b1', 'b2', 'b3'),
        cards('g1', 'g2', 'g3'),
      ],
      handSize: 3,
      rules: { sevenZero: true },
    });
    match.play(0, idOf(match, 0, 'r0'), {});
    expect(view(match).handCounts.slice(0, 3)).toEqual([3, 2, 3]);
    expect(hand(match, 1).cards.map((c) => c.card)).toEqual(cards('r1', 'r2'));
    expect(hand(match, 0).cards.map((c) => c.card)).toEqual(
      cards('g1', 'g2', 'g3'),
    );
  });
});

describe('UnoMatch — timeouts and leaving', () => {
  it('draws one card and passes on a timeout', () => {
    const { match } = setup({ hands: [], rest: cards('r9') });
    const out = match.timeout();
    expect(events(out)).toEqual(['uno:turn_timed_out', 'uno:cards_drawn']);
    expect(view(match).handCounts[0]).toBe(8);
    expect(view(match).turn).toBe(1);
  });

  it('draws the pending cards on a timeout', () => {
    const { match } = setup({ hands: [cards('w+4')] });
    match.play(0, idOf(match, 0, 'w+4'), { color: 'blue' });
    match.timeout();
    expect(view(match).handCounts[1]).toBe(11);
    expect(view(match).turn).toBe(2);
  });

  it('keeps the drawn card on a timeout', () => {
    const { match } = setup({ hands: [], rest: cards('r9') });
    match.draw(0);
    match.timeout();
    expect(view(match).handCounts[0]).toBe(8);
    expect(view(match).turn).toBe(1);
  });

  it('changes the turn token on every turn change', () => {
    const { match } = setup({ hands: [cards('r3')] });
    const before = match.turnToken;
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(match.turnToken).not.toBe(before);
  });

  it('passes the turn and returns the cards to the pile when the turn player leaves', () => {
    const { match } = setup({ hands: [] });
    const pile = view(match).drawPile;
    match.removePlayer(0);
    expect(view(match).turn).toBe(1);
    expect(view(match).handCounts[0]).toBe(0);
    expect(view(match).drawPile).toBe(pile + 7);
    expect(match.privateView(0)).toBeNull();
    expect(match.phase).toBe('PLAYING');
  });

  it('ends the match when only one player is left', () => {
    const { match } = setup({ hands: [], seats: [0, 1] });
    match.removePlayer(1);
    expect(match.phase).toBe('MATCH_OVER');
    expect(match.winner).toBe(0);
  });
});

describe('UnoMatch — scoring', () => {
  it('ends the round on the last card; a final +2 still makes the next player draw', () => {
    const { match } = setup({
      hands: [cards('r+2'), cards('b3'), cards('g4')],
      handSize: 1,
      rest: cards('b9', 'b9'),
    });
    const out = match.play(0, idOf(match, 0, 'r+2'), {});
    expect(view(match).handCounts[1]).toBe(3);
    expect(out).toContainEqual({
      event: 'uno:round_ended',
      payload: { winner: 0, points: 3 + 18 + 4, scores: [25, 0, 0, 0, 0, 0] },
    });
    expect(match.phase).toBe('MATCH_OVER');
    expect(match.winner).toBe(0);
  });

  it('plays rounds until someone reaches the target; the starter rotates', () => {
    const { match } = setup({
      hands: [cards('r3'), cards('b3'), cards('g4')],
      handSize: 1,
      rules: { target: 200 },
    });
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(match.phase).toBe('ROUND_OVER');
    expect(match.winner).toBeNull();
    expect(match.scores[0]).toBe(7);
    expect(view(match).lastRound).toEqual({ winner: 0, points: 7 });
    match.startRound();
    expect(view(match).roundNumber).toBe(2);
    expect(view(match).turn).toBe(1);
    expect(match.phase).toBe('PLAYING');
  });

  it('wins the match on reaching the target', () => {
    const { match } = setup({
      hands: [cards('r3'), cards('b9'), cards('g4')],
      handSize: 1,
      rules: { target: 200 },
      scores: [190, 0, 0, 0, 0, 0],
    });
    match.play(0, idOf(match, 0, 'r3'), {});
    expect(match.scores[0]).toBe(203);
    expect(match.phase).toBe('MATCH_OVER');
    expect(match.winner).toBe(0);
  });
});
