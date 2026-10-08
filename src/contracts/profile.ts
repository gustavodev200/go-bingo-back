import { z } from 'zod';
import { COIN_REASONS } from './coins';

export const nicknameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_À-ú ]{3,16}$/, 'Use 3 a 16 letras, números, espaço ou _');

const BLOCKED_WORDS = [
  'caralho',
  'puta',
  'porra',
  'merda',
  'buceta',
  'viado',
  'cuzao',
  'arrombado',
  'fdp',
  'pnc',
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function isNicknameAllowed(nickname: string): boolean {
  const n = normalize(nickname);
  return !BLOCKED_WORDS.some((w) => n.includes(w));
}

/**
 * Personagens prontos do seletor (setas ← →). O back só conhece os ids; a aparência de cada um mora no front.
 * Nunca remover/renomear um id: perfis salvos apontam para ele.
 */
export const CHARACTER_IDS = [
  'c01',
  'c02',
  'c03',
  'c04',
  'c05',
  'c06',
  'c07',
  'c08',
  'c09',
  'c10',
  'c11',
  'c12',
  'c13',
  'c14',
  'c15',
  'c16',
] as const;
export const characterSchema = z.enum(CHARACTER_IDS);
export type CharacterId = z.infer<typeof characterSchema>;

export const updateProfileSchema = z
  .object({
    nickname: nicknameSchema.optional(),
    character: characterSchema.optional(),
  })
  .refine(
    (p) => p.nickname !== undefined || p.character !== undefined,
    'Nada para atualizar',
  );

export const profileSchema = z.object({
  id: z.uuid(),
  nickname: z.string().nullable(),
  isGuest: z.boolean(),
  /** Personagem escolhido; null = boneco derivado do id. Opcional: um front novo continua funcionando contra uma API anterior ao campo. */
  character: characterSchema.nullish(),
  points: z.number().int(),
  coins: z.number().int().min(0),
});
export type Profile = z.infer<typeof profileSchema>;

/** GET /me: perfil + bônus diário creditado nesta chamada (0 se já recebeu hoje). */
export const meResponseSchema = profileSchema.extend({
  dailyBonus: z.number().int().min(0),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Quantas movimentações de moedas a tela de perfil mostra. */
export const COIN_HISTORY_LIMIT = 20;

export const coinEntrySchema = z.object({
  id: z.uuid(),
  amount: z.number().int(),
  reason: z.enum(COIN_REASONS),
  createdAt: z.string(),
});
export type CoinEntry = z.infer<typeof coinEntrySchema>;

/** GET /me/stats: números da tela de perfil. rank = null fora do ranking (convidado ou sem partidas). */
export const profileStatsSchema = z.object({
  gamesPlayed: z.number().int(),
  wins: z.number().int(),
  points: z.number().int(),
  rank: z.number().int().nullable(),
  coinHistory: z.array(coinEntrySchema),
});
export type ProfileStats = z.infer<typeof profileStatsSchema>;
