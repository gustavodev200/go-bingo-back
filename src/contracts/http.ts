import { z } from 'zod';

export const createRoomResponseSchema = z.object({ code: z.string() });

export const rankingEntrySchema = z.object({
  rank: z.number().int(),
  userId: z.uuid(),
  nickname: z.string(),
  points: z.number().int(),
  /** Partidas pontuadas na semana (só no ranking semanal). */
  matches: z.number().int().optional(),
});

export const RANKING_SCOPES = ['all', 'week'] as const;
export type RankingScope = (typeof RANKING_SCOPES)[number];

export const rankingResponseSchema = z.object({
  entries: z.array(rankingEntrySchema),
  me: z
    .object({
      rank: z.number().int(),
      points: z.number().int(),
      matches: z.number().int().optional(),
    })
    .nullable(),
  scope: z.enum(RANKING_SCOPES).optional(),
  nextCursor: z.number().int().nullable(),
});
export type RankingResponse = z.infer<typeof rankingResponseSchema>;

export const rankingQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  scope: z.enum(RANKING_SCOPES).default('all'),
});
