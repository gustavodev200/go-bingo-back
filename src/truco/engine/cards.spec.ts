import type { TrucoCard } from '../../contracts';
import { cardStrength, newDeck, sameCard, shuffle } from './cards';

const c = (rank: TrucoCard['rank'], suit: TrucoCard['suit']): TrucoCard => ({
  rank,
  suit,
});

describe('newDeck', () => {
  it('has 40 unique cards without 8, 9, 10 or jokers', () => {
    const deck = newDeck();
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((x) => `${x.rank}${x.suit}`)).size).toBe(40);
    expect(deck.some((x) => ['8', '9', '10'].includes(x.rank))).toBe(false);
  });
});

describe('cardStrength', () => {
  it('ranks the fixed manilhas: Zap > Copeta > Espadilha > Pica-fumo', () => {
    const order = [
      c('4', 'clubs'),
      c('7', 'hearts'),
      c('A', 'spades'),
      c('7', 'diamonds'),
    ].map(cardStrength);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    expect(new Set(order).size).toBe(4);
  });

  it('puts every manilha above the strongest common card', () => {
    expect(cardStrength(c('7', 'diamonds'))).toBeGreaterThan(
      cardStrength(c('3', 'hearts')),
    );
  });

  it('orders common cards 3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4', () => {
    const ranks = ['3', '2', 'A', 'K', 'J', 'Q', '7', '6', '5', '4'] as const;
    // Suits chosen to avoid manilhas (4♣, 7♥, A♠, 7♦).
    const strengths = ranks.map((r) => cardStrength(c(r, 'hearts')));
    strengths[ranks.indexOf('7')] = cardStrength(c('7', 'clubs'));
    for (let i = 1; i < strengths.length; i++)
      expect(strengths[i - 1]).toBeGreaterThan(strengths[i]);
  });

  it('ties common cards of the same rank regardless of suit', () => {
    expect(cardStrength(c('3', 'clubs'))).toBe(cardStrength(c('3', 'spades')));
    expect(cardStrength(c('A', 'hearts'))).toBe(
      cardStrength(c('A', 'diamonds')),
    );
    expect(cardStrength(c('4', 'hearts'))).toBe(cardStrength(c('4', 'spades')));
  });

  it('only the manilha suit of a rank is promoted', () => {
    expect(cardStrength(c('7', 'hearts'))).toBeGreaterThan(
      cardStrength(c('7', 'spades')),
    );
    expect(cardStrength(c('A', 'spades'))).toBeGreaterThan(
      cardStrength(c('A', 'clubs')),
    );
  });
});

describe('shuffle', () => {
  it('keeps every card once and does not mutate the input', () => {
    const deck = newDeck();
    let n = 7;
    const out = shuffle(deck, (min, max) => {
      n = (n * 31 + 11) % 997;
      return min + (n % (max - min));
    });
    expect(out).not.toBe(deck);
    expect(out).toHaveLength(40);
    expect(deck.every((d) => out.some((o) => sameCard(o, d)))).toBe(true);
    expect(out).not.toEqual(deck);
  });
});
