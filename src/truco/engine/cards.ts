import {
  MANILHAS,
  TRUCO_RANKS,
  TRUCO_SUITS,
  type TrucoCard,
  type TrucoRank,
} from '../../contracts';
import type { RandomInt } from '../../core/random';

/** Common-card order, weakest first: 4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3. */
const COMMON_STRENGTH: Record<TrucoRank, number> = {
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  Q: 5,
  J: 6,
  K: 7,
  A: 8,
  '2': 9,
  '3': 10,
};

/**
 * Comparable strength of a card. Manilhas (Zap 14, Copeta 13, Espadilha 12,
 * Pica-fumo 11) beat every common card; equal common ranks tie regardless of suit.
 */
export function cardStrength(card: TrucoCard): number {
  const manilha = MANILHAS.findIndex(
    (m) => m.rank === card.rank && m.suit === card.suit,
  );
  if (manilha >= 0) return 14 - manilha;
  return COMMON_STRENGTH[card.rank];
}

export function newDeck(): TrucoCard[] {
  return TRUCO_SUITS.flatMap((suit) =>
    TRUCO_RANKS.map((rank) => ({ rank, suit })),
  );
}

/** Fisher–Yates with an injectable (crypto in production) RNG. */
export function shuffle<T>(items: readonly T[], random: RandomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const sameCard = (a: TrucoCard, b: TrucoCard) =>
  a.rank === b.rank && a.suit === b.suit;
