import { z } from 'zod';

/**
 * Diamantes: a moeda premium. Chegam todo dia (resgate manual) e no ranking semanal, e viram
 * moedas em pacotes (pacote maior rende mais). Só contas logadas: convidado descartável não
 * pode farmar diamantes para passar moedas para outra conta.
 */
export const DIAMONDS_DAILY = 10;
/** Dias seguidos de resgate formam um ciclo; o último dia do ciclo paga um extra. */
export const DIAMOND_STREAK_DAYS = 7;
export const DIAMOND_STREAK_BONUS = 15;
/** Valor base: 1 diamante = 50 moedas. */
export const COINS_PER_DIAMOND = 50;
/** Pacotes de troca: quem junta diamantes ganha bônus. */
export const DIAMOND_PACKS = [
  { diamonds: 1, coins: 50 },
  { diamonds: 10, coins: 550 },
  { diamonds: 50, coins: 3000 },
] as const;
/** Ranking semanal também paga diamantes (top 1, 2, 3). */
export const WEEKLY_DIAMONDS = [30, 20, 10] as const;

export const DIAMOND_REASONS = [
  'DAILY',
  'STREAK',
  'EXCHANGE',
  'SEASON',
] as const;
export type DiamondReason = (typeof DIAMOND_REASONS)[number];

/** Diamantes do resgate no dia `day` do ciclo (1..DIAMOND_STREAK_DAYS). */
export function diamondRewardFor(day: number): number {
  return (
    DIAMONDS_DAILY + (day === DIAMOND_STREAK_DAYS ? DIAMOND_STREAK_BONUS : 0)
  );
}

export const diamondStatusSchema = z.object({
  diamonds: z.number().int().min(0),
  coins: z.number().int().min(0),
  /** Dias já resgatados no ciclo atual (0..7). Zera se pular um dia. */
  streakDay: z.number().int().min(0),
  claimedToday: z.boolean(),
  /** Quanto o próximo resgate paga (hoje se ainda não resgatou, senão amanhã). */
  nextReward: z.number().int().min(0),
  /** Convidado não ganha diamantes. */
  eligible: z.boolean(),
});
export type DiamondStatus = z.infer<typeof diamondStatusSchema>;

/** POST /diamonds/claim */
export const diamondClaimResponseSchema = z.object({
  claimed: z.number().int().min(0),
  status: diamondStatusSchema,
});
export type DiamondClaimResponse = z.infer<typeof diamondClaimResponseSchema>;

/** POST /diamonds/exchange: troca um dos pacotes. */
export const diamondExchangeSchema = z.object({
  diamonds: z
    .number()
    .int()
    .refine(
      (n) => DIAMOND_PACKS.some((p) => p.diamonds === n),
      'Pacote inválido',
    ),
});
export type DiamondExchangeInput = z.infer<typeof diamondExchangeSchema>;

export const diamondExchangeResponseSchema = z.object({
  coins: z.number().int().min(0),
  status: diamondStatusSchema,
});
export type DiamondExchangeResponse = z.infer<
  typeof diamondExchangeResponseSchema
>;
