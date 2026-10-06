import type { AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import type { PrismaService } from '../core/prisma.service';
import { ProfilesService } from './profiles.service';

function makePrisma() {
  return {
    profile: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
}

const row = {
  id: 'u1',
  nickname: 'Fulano',
  isGuest: false,
  points: 10,
  gamesPlayed: 2,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('ProfilesService', () => {
  it('ensure() upserts the profile, mirroring is_anonymous into isGuest', async () => {
    const prisma = makePrisma();
    prisma.profile.upsert.mockResolvedValue(row);
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: true };

    const result = await service.ensure(user);

    expect(prisma.profile.upsert).toHaveBeenCalledWith({
      where: { id: 'u1' },
      create: { id: 'u1', isGuest: true },
      update: { isGuest: true },
    });
    expect(result).toBe(row);
  });

  it('setNickname() rejects a malformed nickname with the Zod message', async () => {
    const prisma = makePrisma();
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    await expect(service.setNickname(user, 'a')).rejects.toMatchObject({
      code: 'NICKNAME_INVALID',
    });
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('setNickname() rejects a well-formed but blocked nickname', async () => {
    const prisma = makePrisma();
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    await expect(service.setNickname(user, 'porra')).rejects.toEqual(
      new DomainError('NICKNAME_INVALID', 'Apelido não permitido'),
    );
  });

  it('setNickname() ensures the profile exists, persists and returns the DTO', async () => {
    const prisma = makePrisma();
    prisma.profile.upsert.mockResolvedValue(row);
    prisma.profile.update.mockResolvedValue({ ...row, nickname: 'Novo Nome' });
    const service = new ProfilesService(prisma as unknown as PrismaService);
    const user: AuthUser = { id: 'u1', isAnonymous: false };

    const result = await service.setNickname(user, 'Novo Nome');

    expect(prisma.profile.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { nickname: 'Novo Nome' },
    });
    expect(result).toEqual({
      id: 'u1',
      nickname: 'Novo Nome',
      isGuest: false,
      points: 10,
    });
  });

  it('toDto() projects only the public profile fields', () => {
    const service = new ProfilesService({} as unknown as PrismaService);
    expect(service.toDto(row)).toEqual({
      id: 'u1',
      nickname: 'Fulano',
      isGuest: false,
      points: 10,
    });
  });
});
