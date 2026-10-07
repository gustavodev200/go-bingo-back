import { z } from 'zod';
import {
  DEFAULT_DRAW_INTERVAL_MS,
  MAX_DRAW_INTERVAL_MS,
  MIN_DRAW_INTERVAL_MS,
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
