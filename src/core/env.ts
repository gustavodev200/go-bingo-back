import { z } from 'zod';
import {
  DEFAULT_DRAW_INTERVAL_MS,
  MAX_DRAW_INTERVAL_MS,
  MIN_DRAW_INTERVAL_MS,
  voiceIceServerSchema,
} from '../contracts';

// Templates de secrets costumam deixar a variável vazia; vazio = ausente.
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(0).default(3333),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  // Uma ou mais origens separadas por vírgula (ex.: front local + front em produção).
  CORS_ORIGIN: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  SUPABASE_URL: z.url(),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
  SENTRY_ENVIRONMENT: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  // z.coerce.boolean() faria TRUST_PROXY=false virar `true` (Boolean("false")
  // é truthy — qualquer string não vazia é). z.stringbool() interpreta o
  // literal "true"/"false" (e variantes como "1"/"0") corretamente.
  TRUST_PROXY: z.stringbool().default(false),
  // Tempo padrão entre bolas das salas novas (o host ainda pode escolher outro ao criar).
  DEFAULT_DRAW_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(MIN_DRAW_INTERVAL_MS)
    .max(MAX_DRAW_INTERVAL_MS)
    .default(DEFAULT_DRAW_INTERVAL_MS),
  // Truco: how long a disconnected player's seat stays reserved.
  TRUCO_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // Truco: pause between the end of a hand and the next deal.
  TRUCO_HAND_PAUSE_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(2_500),
  // Truco: tables kept in memory at most (one per player).
  TRUCO_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // Truco Gaudério: how long a disconnected player's seat stays reserved.
  GAUDERIO_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // Truco Gaudério: pause between the end of a hand and the next deal.
  GAUDERIO_HAND_PAUSE_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(2_500),
  // Truco Gaudério: tables kept in memory at most (one per player).
  GAUDERIO_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // UNO: how long a disconnected player's seat stays reserved.
  UNO_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // UNO: time to act on a turn before it is played automatically.
  UNO_TURN_MS: z.coerce.number().int().min(5_000).max(120_000).default(25_000),
  // UNO: pause between the end of a round and the next deal.
  UNO_ROUND_PAUSE_MS: z.coerce.number().int().min(0).max(15_000).default(4_000),
  // UNO: tables kept in memory at most (one per player).
  UNO_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // Dominó: how long a disconnected player's seat stays reserved.
  DOMINO_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // Dominó: time to act on a turn before it is played automatically.
  DOMINO_TURN_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(120_000)
    .default(25_000),
  // Dominó: pause between the end of a round and the next deal.
  DOMINO_ROUND_PAUSE_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(15_000)
    .default(5_000),
  // Dominó: tables kept in memory at most (one per player).
  DOMINO_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // Damas: how long a disconnected player's seat stays reserved.
  DAMAS_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // Damas: tables kept in memory at most (one per player).
  DAMAS_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // Blackjack: how long a disconnected player's seat stays reserved.
  BLACKJACK_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // Blackjack: tables kept in memory at most (one per player).
  BLACKJACK_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // Tacada: how long a disconnected player's seat stays reserved.
  TACADA_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(60_000),
  // Tacada: tables kept in memory at most (one per player).
  TACADA_MAX_ROOMS: z.coerce.number().int().min(1).default(1_000),
  // Bomberman: how long a disconnected player's seat stays reserved.
  BOMBER_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(30_000),
  // Bomberman: pause between the end of a round and the next one.
  BOMBER_ROUND_PAUSE_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(15_000)
    .default(3_500),
  // Bomberman: rooms kept in memory at most (each runs a 30 Hz loop while playing).
  BOMBER_MAX_ROOMS: z.coerce.number().int().min(1).default(300),
  // Futebol de botão: how long a disconnected player's seat stays reserved.
  BOTAO_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(30_000),
  // Futebol de botão: rooms kept in memory at most (each runs a 30 Hz loop while playing).
  BOTAO_MAX_ROOMS: z.coerce.number().int().min(1).default(300),
  // Infiltrado: how long a disconnected player's seat stays reserved.
  INF_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(45_000),
  // Infiltrado: rooms kept in memory at most (each runs a 20 Hz loop while playing).
  INF_MAX_ROOMS: z.coerce.number().int().min(1).default(200),
  // Snake.io: how long a disconnected player keeps the place in the room.
  SNAKE_RECONNECT_GRACE_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(30_000),
  // Snake.io: rooms kept in memory at most (each runs a 20 Hz loop).
  SNAKE_MAX_ROOMS: z.coerce.number().int().min(1).default(200),
  // Voice chat: ICE servers handed to the browsers, as JSON (e.g. a TURN
  // server for players behind strict NATs). Absent = public STUN only.
  VOICE_ICE_SERVERS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((v, ctx) => {
        try {
          return JSON.parse(v) as unknown;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'JSON inválido' });
          return z.NEVER;
        }
      })
      .pipe(z.array(voiceIceServerSchema).min(1))
      .optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Variáveis de ambiente inválidas:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}
