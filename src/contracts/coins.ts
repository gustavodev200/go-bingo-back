import { ARENA_RULES } from './arena';
import type { WinPattern } from './bingo';

/** Economia de moedas (cash do jogo). Saldo nunca fica negativo. Convidados participam igual. */
export const WELCOME_COINS = 1000;
export const DAILY_COINS = 50;
export const CARD_COST = 5;
/** Bônus da casa ao vencedor por modo da sala (soma-se ao pote das entradas; ver contracts/arena). */
export const WIN_COINS: Record<WinPattern, number> = {
  FULL_CARD: ARENA_RULES.BINGO.winBonus,
  LINE: ARENA_RULES.BINGO.winBonus / 2,
};
/** Entrada de quem tinha cartela numa partida que outro venceu (até zerar o saldo); vai para o pote. */
export const LOSS_COINS = ARENA_RULES.BINGO.ante;

export const COIN_REASONS = [
  'WELCOME',
  'DAILY',
  'CARD',
  'WIN',
  'LOSS',
  /** Entrada de uma disputa (Arena). */
  'STAKE',
  /** Parte do pote ganha pela colocação. */
  'PRIZE',
  /** Bônus da casa: vitória, sequência, virada... */
  'BONUS',
  /** Multa de quem abandona a partida. */
  'PENALTY',
  /** Bônus por subir de liga. */
  'TIER',
  /** Prêmio do ranking semanal. */
  'SEASON',
] as const;
export type CoinReason = (typeof COIN_REASONS)[number];
