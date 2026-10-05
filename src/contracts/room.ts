import { z } from 'zod';

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
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const roomStatusSchema = z.enum(['WAITING', 'IN_GAME', 'CLOSED']);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const publicRoomSchema = z.object({
  code: z.string(),
  name: z.string(),
  playerCount: z.number().int(),
  maxPlayers: z.number().int(),
  status: roomStatusSchema,
});
export type PublicRoom = z.infer<typeof publicRoomSchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
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
  members: z.array(memberSchema),
  myCard: cardSchema.nullable(),
  game: gameStateSchema.nullable(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const winnerSchema = z.object({
  userId: z.uuid(),
  nickname: z.string(),
  pointsAwarded: z.number().int(),
  grid: z.array(z.number().int()).length(25),
});
export type Winner = z.infer<typeof winnerSchema>;
