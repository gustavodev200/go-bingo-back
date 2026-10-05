import { z } from 'zod';

export const nicknameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_À-ú ]{3,16}$/, 'Use 3 a 16 letras, números, espaço ou _');

const BLOCKED_WORDS = [
  'caralho',
  'puta',
  'porra',
  'merda',
  'buceta',
  'viado',
  'cuzao',
  'arrombado',
  'fdp',
  'pnc',
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function isNicknameAllowed(nickname: string): boolean {
  const n = normalize(nickname);
  return !BLOCKED_WORDS.some((w) => n.includes(w));
}

export const updateProfileSchema = z.object({ nickname: nicknameSchema });

export const profileSchema = z.object({
  id: z.uuid(),
  nickname: z.string().nullable(),
  isGuest: z.boolean(),
  points: z.number().int(),
});
export type Profile = z.infer<typeof profileSchema>;
