import { z } from 'zod';
import { minStake } from './arena';
import {
  MAX_DRAW_INTERVAL_MS,
  MIN_DRAW_INTERVAL_MS,
  WIN_PATTERNS,
} from './bingo';

export const winPatternSchema = z.enum(WIN_PATTERNS);

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/, 'Código inválido');

export const createRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Nome com no mínimo 3 caracteres')
    .max(24, 'Nome com no máximo 24 caracteres'),
  maxPlayers: z.union([z.literal(10), z.literal(15), z.literal(25)]),
  isPublic: z.boolean(),
  /** Tempo entre bolas; ausente = padrão do servidor. */
  drawIntervalMs: z
    .number()
    .int()
    .min(MIN_DRAW_INTERVAL_MS)
    .max(MAX_DRAW_INTERVAL_MS)
    .optional(),
  /** Modo de vitória; ausente = cartela cheia. */
  winPattern: winPatternSchema.optional(),
  /** Aposta de cada jogador (STAKE_LEVELS do bingo); ausente = mínimo. */
  stake: z.number().int().positive().optional(),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/**
 * CPU no bingo: cartelas extras jogadas pelo servidor (sem perfil, ids fixos abaixo). A CPU
 * "grita bingo" no sorteio seguinte ao que completou a cartela, se ninguém gritou antes.
 */
export const BINGO_MAX_CPUS = 3;
export const BINGO_CPU_IDS = [
  '00000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c002',
  '00000000-0000-4000-8000-00000000c003',
] as const;
export const isBingoCpu = (userId: string) =>
  (BINGO_CPU_IDS as readonly string[]).includes(userId);
/** "CPU 1", "CPU 2"… pelo id fixo; null quando não é CPU. */
export function bingoCpuName(userId: string): string | null {
  const i = (BINGO_CPU_IDS as readonly string[]).indexOf(userId);
  return i < 0 ? null : `CPU ${i + 1}`;
}
export const setCpusPayloadSchema = z.object({
  count: z.number().int().min(0).max(BINGO_MAX_CPUS),
});

export const roomStatusSchema = z.enum(['WAITING', 'IN_GAME', 'CLOSED']);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const publicRoomSchema = z.object({
  code: z.string(),
  name: z.string(),
  playerCount: z.number().int(),
  maxPlayers: z.number().int(),
  status: roomStatusSchema,
  winPattern: winPatternSchema,
  stake: z.number().int().default(minStake('BINGO')),
});
export type PublicRoom = z.infer<typeof publicRoomSchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  /** Id do personagem escolhido (null = derivado do userId). String solta: id desconhecido cai no derivado. */
  character: z.string().nullish(),
  slot: z.number().int(),
  isGuest: z.boolean(),
  connected: z.boolean(),
  hasCard: z.boolean(),
});
export type Member = z.infer<typeof memberSchema>;

export const cardSchema = z.object({
  id: z.uuid(),
  grid: z.array(z.number().int()).length(25),
  marked: z.array(z.number().int().min(0).max(24)),
});
export type Card = z.infer<typeof cardSchema>;

export const gameStateSchema = z.object({
  id: z.uuid(),
  drawn: z.array(z.number().int()),
  drawIntervalMs: z.number().int(),
  remaining: z.record(z.string(), z.number().int()),
});
export type GameState = z.infer<typeof gameStateSchema>;

export const roomSnapshotSchema = z.object({
  code: z.string(),
  name: z.string(),
  hostId: z.uuid(),
  maxPlayers: z.number().int(),
  isPublic: z.boolean(),
  status: roomStatusSchema,
  winPattern: winPatternSchema,
  stake: z.number().int().default(minStake('BINGO')),
  /** Cartelas da CPU na próxima partida (ou na que está rolando). */
  cpuPlayers: z.number().int().min(0).max(BINGO_MAX_CPUS).default(0),
  members: z.array(memberSchema),
  myCard: cardSchema.nullable(),
  game: gameStateSchema.nullable(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const winnerSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  pointsAwarded: z.number().int(),
  coinsAwarded: z.number().int(),
  grid: z.array(z.number().int()).length(25),
});
export type Winner = z.infer<typeof winnerSchema>;
