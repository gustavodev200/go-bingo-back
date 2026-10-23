import { z } from 'zod';
import { ARENA_GAMES } from './arena';
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
 * Boneco jogador (craque de futebol): o perfil guarda um código curto `<rosto><camisa><número>` — ex.: `afla10` =
 * rosto "a", camisa do Flamengo, número 10 (`00` = sem número). O back só conhece os ids; cores, padrões e rostos
 * moram no front. Nunca remover/renomear um id: perfis salvos apontam para ele (id desconhecido = boneco padrão).
 */
export const CHARACTER_FACES = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
] as const;
export type CharacterFace = (typeof CHARACTER_FACES)[number];

/** Camisas: 20 clubes da Série A 2026, internacionais, temáticas e originais da comunidade. */
export const JERSEY_IDS = [
  // Brasileirão Série A 2026
  'fla',
  'pal',
  'cru',
  'mir',
  'flu',
  'bah',
  'bot',
  'spa',
  'rbb',
  'cor',
  'gre',
  'vas',
  'cam',
  'san',
  'int',
  'cfc',
  'cap',
  'cha',
  'rem',
  'vit',
  // internacionais
  'rma',
  'bar',
  // temáticas (políticas, opcionais)
  'lul',
  'bol',
  // originais da comunidade
  'gpl',
  'tub',
  'vul',
  'lob',
] as const;
export type JerseyId = (typeof JERSEY_IDS)[number];

/** Número nas costas: 1..99; 0 = sem número. */
export const MAX_BACK_NUMBER = 99;

export interface CharacterConfig {
  face: CharacterFace;
  jersey: JerseyId;
  number: number;
}

const CHARACTER_RE = /^([a-z])([a-z]{3})(\d{2})$/;

export function parseCharacter(code: unknown): CharacterConfig | null {
  if (typeof code !== 'string') return null;
  const m = CHARACTER_RE.exec(code);
  if (!m) return null;
  const [, face, jersey, number] = m;
  if (!(CHARACTER_FACES as readonly string[]).includes(face)) return null;
  if (!(JERSEY_IDS as readonly string[]).includes(jersey)) return null;
  return {
    face: face as CharacterFace,
    jersey: jersey as JerseyId,
    number: Number(number),
  };
}

export function encodeCharacter(c: CharacterConfig): string {
  const n = Math.max(0, Math.min(MAX_BACK_NUMBER, Math.trunc(c.number)));
  return `${c.face}${c.jersey}${n.toString().padStart(2, '0')}`;
}

export const characterSchema = z
  .string()
  .refine((v) => parseCharacter(v) !== null, 'Personagem inválido');
/** Código do personagem (ver `parseCharacter`). */
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
  character: characterSchema.nullish().catch(null),
  points: z.number().int(),
  coins: z.number().int().min(0),
  /** Moeda premium (ver contracts/diamonds). Opcional: front novo contra API anterior. */
  diamonds: z.number().int().min(0).default(0),
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
  /** > 0 vitórias seguidas, < 0 derrotas seguidas (todos os jogos). */
  streak: z.number().int().default(0),
  bestStreak: z.number().int().default(0),
  /** Partidas e vitórias por jogo (Arena). */
  perGame: z
    .array(
      z.object({
        game: z.enum(ARENA_GAMES),
        played: z.number().int(),
        wins: z.number().int(),
      }),
    )
    .default([]),
  coinHistory: z.array(coinEntrySchema),
});
export type ProfileStats = z.infer<typeof profileStatsSchema>;
