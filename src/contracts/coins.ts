import type { WinPattern } from './bingo';

/** Economia de moedas (cash do jogo). Saldo nunca fica negativo. Convidados participam igual. */
export const WELCOME_COINS = 1000;
export const DAILY_COINS = 50;
export const CARD_COST = 5;
/** Prêmio do vencedor por modo da sala. */
export const WIN_COINS: Record<WinPattern, number> = {
  FULL_CARD: 200,
  LINE: 100,
};
/** Desconto de quem tinha cartela numa partida que outro venceu (até zerar o saldo). */
export const LOSS_COINS = 20;

export const COIN_REASONS = [
  'WELCOME',
  'DAILY',
  'CARD',
  'WIN',
  'LOSS',
] as const;
export type CoinReason = (typeof COIN_REASONS)[number];
