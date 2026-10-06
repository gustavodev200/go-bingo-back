import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(0).default(3333),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  CORS_ORIGIN: z.url(),
  SUPABASE_URL: z.url(),
  SENTRY_DSN: z.url().optional(),
  SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  // z.coerce.boolean() faria TRUST_PROXY=false virar `true` (Boolean("false")
  // é truthy — qualquer string não vazia é). z.stringbool() interpreta o
  // literal "true"/"false" (e variantes como "1"/"0") corretamente.
  TRUST_PROXY: z.stringbool().default(false),
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
