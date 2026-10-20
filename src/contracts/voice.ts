import { z } from 'zod';
import { roomCodeSchema } from './room';

// ---------------------------------------------------------------------------
// Voice chat: WebRTC audio straight between browsers (full mesh). The server
// only checks who may talk in a room and relays the WebRTC handshake.
// ---------------------------------------------------------------------------

export const VOICE_NAMESPACE = '/voice';

export const VOICE_GAMES = [
  'bingo',
  'truco',
  'uno',
  'domino',
  'infiltrado',
  'damas',
  'blackjack',
  'tacada',
  'gauderio',
] as const;
export type VoiceGame = (typeof VOICE_GAMES)[number];

/** Full mesh: every peer uploads its audio once per other peer, so the channel stays small. */
export const VOICE_MAX_PEERS = 8;
/** Infiltrado meetings seat up to 15 (short talks, so the bigger mesh is fine). */
export const voiceMaxPeers = (game: VoiceGame) =>
  game === 'infiltrado' ? 15 : VOICE_MAX_PEERS;

export const voiceChannel = (game: VoiceGame, code: string) =>
  `voice:${game}:${code}`;

export const voiceIceServerSchema = z
  .object({
    urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })
  .strict();
export type VoiceIceServer = z.infer<typeof voiceIceServerSchema>;

export const DEFAULT_VOICE_ICE_SERVERS: VoiceIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

export const voiceJoinSchema = z
  .object({
    game: z.enum(VOICE_GAMES),
    code: roomCodeSchema,
    muted: z.boolean(),
  })
  .strict();
export const voiceEmptySchema = z.object({}).strict();
export const voiceMuteSchema = z.object({ muted: z.boolean() }).strict();

const sdpSchema = z.string().min(1).max(20_000);
export const voiceSignalDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offer'), sdp: sdpSchema }).strict(),
  z.object({ kind: z.literal('answer'), sdp: sdpSchema }).strict(),
  z
    .object({
      kind: z.literal('candidate'),
      candidate: z.string().max(1_000),
      sdpMid: z.string().max(64).nullable(),
      sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
    })
    .strict(),
]);
export type VoiceSignalData = z.infer<typeof voiceSignalDataSchema>;

export const voiceSignalSchema = z
  .object({ to: z.string().min(1).max(64), data: voiceSignalDataSchema })
  .strict();

export interface VoicePeer {
  /** Socket id of the peer in the /voice namespace. */
  peerId: string;
  userId: string;
  nickname: string;
  muted: boolean;
}

export interface VoiceJoined {
  peerId: string;
  /** Everyone already in the channel; the newcomer sends each of them an offer. */
  peers: VoicePeer[];
  iceServers: VoiceIceServer[];
}

export type VoiceRemovedReason = 'replaced' | 'not_member';

export const VoiceClientEvents = {
  JOIN: 'voice:join',
  LEAVE: 'voice:leave',
  SIGNAL: 'voice:signal',
  MUTE: 'voice:mute',
} as const;

export const VoiceServerEvents = {
  PEER_JOINED: 'voice:peer_joined',
  PEER_LEFT: 'voice:peer_left',
  PEER_UPDATED: 'voice:peer_updated',
  SIGNAL: 'voice:signal',
  REMOVED: 'voice:removed',
} as const;

export interface VoiceServerEventPayloads {
  'voice:peer_joined': VoicePeer;
  'voice:peer_left': { peerId: string };
  'voice:peer_updated': { peerId: string; muted: boolean };
  'voice:signal': { from: string; data: VoiceSignalData };
  'voice:removed': { reason: VoiceRemovedReason };
}

export interface VoiceClientAckData {
  'voice:join': VoiceJoined;
  'voice:leave': null;
  'voice:signal': null;
  'voice:mute': null;
}
