import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'INVALID_PAYLOAD',
  'RATE_LIMITED',
  'NOT_FOUND',
  'ROOM_FULL',
  'GAME_IN_PROGRESS',
  'NOT_HOST',
  'NOT_IN_ROOM',
  'NOT_ENOUGH_PLAYERS',
  'NICKNAME_REQUIRED',
  'NICKNAME_INVALID',
  'REGEN_LIMIT',
  'INVALID_STATE',
  'NOT_DRAWN',
  'BINGO_INVALID',
  'INSUFFICIENT_COINS',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };
