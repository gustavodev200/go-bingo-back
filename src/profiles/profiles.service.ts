import { Injectable } from '@nestjs/common';
import { isNicknameAllowed, nicknameSchema, type Profile } from '../contracts';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { PrismaService } from '../core/prisma.service';
import type { Profile as ProfileRow } from '../generated/prisma/client';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria o perfil no primeiro acesso e mantém isGuest espelhando a claim is_anonymous. */
  ensure(user: AuthUser): Promise<ProfileRow> {
    return this.prisma.profile.upsert({
      where: { id: user.id },
      create: { id: user.id, isGuest: user.isAnonymous },
      update: { isGuest: user.isAnonymous },
    });
  }

  async setNickname(user: AuthUser, raw: string): Promise<Profile> {
    const parsed = nicknameSchema.safeParse(raw);
    if (!parsed.success || !isNicknameAllowed(parsed.data)) {
      throw new DomainError(
        'NICKNAME_INVALID',
        parsed.success
          ? 'Apelido não permitido'
          : parsed.error.issues[0].message,
      );
    }
    await this.ensure(user);
    return this.toDto(
      await this.prisma.profile.update({
        where: { id: user.id },
        data: { nickname: parsed.data },
      }),
    );
  }

  toDto(row: ProfileRow): Profile {
    return {
      id: row.id,
      nickname: row.nickname,
      isGuest: row.isGuest,
      points: row.points,
    };
  }
}
