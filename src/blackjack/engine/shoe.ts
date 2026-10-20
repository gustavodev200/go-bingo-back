import { BJ_RANKS, BJ_SUITS, type BjCard } from '../../contracts';
import type { RandomInt } from '../../core/random';

/** Every card of `decks` standard 52-card decks, unshuffled. */
export function fullShoe(decks: number): BjCard[] {
  const cards: BjCard[] = [];
  for (let d = 0; d < decks; d++)
    for (const suit of BJ_SUITS)
      for (const rank of BJ_RANKS) cards.push(`${rank}${suit}`);
  return cards;
}

/** Fisher–Yates in place. */
export function shuffle<T>(items: T[], random: RandomInt): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * The dealing shoe. Cards come out from the front (an index, no copying).
 * `refill` builds a fresh shuffled shoe without the cards still on the table,
 * so a long round never shows a card more times than the decks hold.
 */
export class Shoe {
  private cards: BjCard[] = [];
  private pos = 0;

  constructor(
    private readonly decks: number,
    private readonly random: RandomInt,
    /** Tests: these come out first, in order, before a normal shuffled shoe. */
    stack: readonly BjCard[] = [],
  ) {
    this.refill([]);
    if (stack.length > 0) this.cards = [...stack, ...this.cards];
  }

  get size(): number {
    return this.cards.length;
  }

  get left(): number {
    return this.cards.length - this.pos;
  }

  /** Next card; refills (without the cards in play) when it runs out. */
  draw(inPlay: () => readonly BjCard[]): { card: BjCard; shuffled: boolean } {
    let shuffled = false;
    if (this.left === 0) {
      this.refill(inPlay());
      shuffled = true;
    }
    return { card: this.cards[this.pos++], shuffled };
  }

  refill(inPlay: readonly BjCard[]): void {
    const cards = fullShoe(this.decks);
    for (const c of inPlay) {
      const i = cards.indexOf(c);
      if (i >= 0) cards.splice(i, 1);
    }
    this.cards = shuffle(cards, this.random);
    this.pos = 0;
  }
}
