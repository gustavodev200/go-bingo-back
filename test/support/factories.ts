import { randomUUID } from 'node:crypto';
import type { TestApp } from './app';

let codeCounter = 0;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function nextCode(): string {
  let n = codeCounter++;
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length);
  }
  return code;
}

export async function makeUser(
  t: TestApp,
  nickname: string | null = 'Jogador',
  opts: { isAnonymous?: boolean } = {},
) {
  const id = randomUUID();
  await t.prisma.profile.create({
    data: { id, nickname, isGuest: opts.isAnonymous ?? false },
  });
  return {
    id,
    token: await t.auth.sign(id, { isAnonymous: opts.isAnonymous }),
  };
}

export async function makeRoom(
  t: TestApp,
  hostId: string,
  overrides: { maxPlayers?: number; isPublic?: boolean } = {},
) {
  const room = await t.prisma.room.create({
    data: {
      code: nextCode(),
      name: 'Sala Teste',
      hostId,
      maxPlayers: overrides.maxPlayers ?? 10,
      isPublic: overrides.isPublic ?? true,
      members: { create: { userId: hostId, slot: 0 } },
    },
  });
  return { id: room.id, code: room.code };
}
