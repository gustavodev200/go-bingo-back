import { z } from 'zod';

export const createRoomResponseSchema = z.object({ code: z.string() });

export const rankingEntrySchema = z.object({
  rank: z.number().int(),
  userId: z.uuid(),
  nickname: z.string(),
  points: z.number().int(),
});

export const rankingResponseSchema = z.object({
  entries: z.array(rankingEntrySchema),
  me: z.object({ rank: z.number().int(), points: z.number().int() }).nullable(),
  nextCursor: z.number().int().nullable(),
});
export type RankingResponse = z.infer<typeof rankingResponseSchema>;

export const rankingQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
});
