import { z } from 'zod';
import type { BingoLetter } from './bingo';
import {
  memberSchema,
  publicRoomSchema,
  roomCodeSchema,
  type RoomSnapshot,
  type Winner,
  type Card,
  type PublicRoom,
  type Member,
} from './room';

export const ClientEvents = {
  ROOMS_WATCH: 'rooms:watch',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_KICK: 'room:kick',
  ROOM_CANCEL: 'room:cancel',
  CARD_GENERATE: 'card:generate',
  GAME_START: 'game:start',
  CARD_MARK: 'card:mark',
  BINGO_CLAIM: 'bingo:claim',
  GAME_REPLAY: 'game:replay',
} as const;

export const ServerEvents = {
  ROOMS_UPDATED: 'rooms:updated',
  ROOM_STATE: 'room:state',
  MEMBER_JOINED: 'room:member_joined',
  MEMBER_READY: 'room:member_ready',
  MEMBER_LEFT: 'room:member_left',
  HOST_CHANGED: 'room:host_changed',
  ROOM_CLOSED: 'room:closed',
  GAME_STARTED: 'game:started',
  NUMBER_DRAWN: 'game:number_drawn',
  GAME_PROGRESS: 'game:progress',
  GAME_WON: 'game:won',
  GAME_ENDED: 'game:ended',
} as const;

export const emptyPayloadSchema = z.object({}).strict();
export const joinRoomPayloadSchema = z.object({ code: roomCodeSchema });
export const kickPayloadSchema = z.object({ userId: z.uuid() });
export const markPayloadSchema = z.object({
  index: z.number().int().min(0).max(24),
});

export const memberLeftReasonSchema = z.enum([
  'disconnected',
  'left',
  'kicked',
  'expired',
]);
export type MemberLeftReason = z.infer<typeof memberLeftReasonSchema>;
export const roomClosedReasonSchema = z.enum(['host_cancelled', 'empty']);
export type RoomClosedReason = z.infer<typeof roomClosedReasonSchema>;
/** exhausted = as 75 bolas saíram sem bingo; no_players = só sobraram espectadores na sala. */
export const gameEndedReasonSchema = z.enum(['exhausted', 'no_players']);
export type GameEndedReason = z.infer<typeof gameEndedReasonSchema>;

export const numberDrawnSchema = z.object({
  seq: z.number().int(),
  number: z.number().int().min(1).max(75),
  letter: z.enum(['B', 'I', 'N', 'G', 'O']),
  drawnAt: z.string(),
});
export type NumberDrawn = {
  seq: number;
  number: number;
  letter: BingoLetter;
  drawnAt: string;
};

export const memberJoinedSchema = z.object({
  member: memberSchema,
  reconnected: z.boolean(),
});
export const roomsUpdatedSchema = z.object({
  rooms: z.array(publicRoomSchema),
});

export interface ServerEventPayloads {
  'rooms:updated': { rooms: PublicRoom[] };
  'room:state': RoomSnapshot;
  'room:member_joined': { member: Member; reconnected: boolean };
  'room:member_ready': { userId: string };
  'room:member_left': { userId: string; reason: MemberLeftReason };
  'room:host_changed': { hostId: string };
  'room:closed': { reason: RoomClosedReason };
  'game:started': { gameId: string; drawIntervalMs: number };
  'game:number_drawn': NumberDrawn;
  'game:progress': { remaining: Record<string, number> };
  'game:won': Winner;
  'game:ended': { reason: GameEndedReason };
}
export type ServerEventName = keyof ServerEventPayloads;

export interface ClientAckData {
  'rooms:watch': PublicRoom[];
  'room:join': RoomSnapshot;
  'room:leave': null;
  'room:kick': null;
  'room:cancel': null;
  'card:generate': Card;
  'game:start': null;
  'card:mark': { marked: number[] };
  'bingo:claim': Winner;
  'game:replay': null;
}

export const PUBLIC_ROOMS_CHANNEL = 'public-rooms';
export const roomChannel = (code: string) => `room:${code}`;
export const userChannel = (userId: string) => `user:${userId}`;
