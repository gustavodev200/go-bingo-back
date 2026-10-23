import { z } from 'zod';

// ---------------------------------------------------------------------------
// Presence: how many distinct players are on the platform right now. Every
// open tab keeps one socket on this namespace; the server counts users, not
// tabs, and pushes the number whenever it changes.
// ---------------------------------------------------------------------------

export const PRESENCE_NAMESPACE = '/presence';

export const PresenceServerEvents = {
  COUNT: 'presence:count',
} as const;

export const presenceCountSchema = z
  .object({ online: z.number().int().nonnegative() })
  .strict();
export type PresenceCount = z.infer<typeof presenceCountSchema>;
