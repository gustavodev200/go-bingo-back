import { Injectable } from '@nestjs/common';
import { credit, saoPauloDay } from '../coins/ledger';
import {
  COIN_HISTORY_LIMIT,
  DAILY_COINS,
  isNicknameAllowed,
  nicknameSchema,
  WELCOME_COINS,
  type Profile,
  type ProfileStats,
} from '../contracts';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { isUniqueViolation } from '../core/prisma-errors';
import { PrismaService } from '../core/prisma.service';
import type { Profile as ProfileRow } from '../generated/prisma/client';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria o perfil no primeiro acesso (com as moedas de boas-vindas) e mantém isGuest
   * espelhando a claim is_anonymous.
   */
  async ensure(user: AuthUser): Promise<ProfileRow> {
    const existing = await this.prisma.profile.findUnique({
      where: { id: user.id },
    });
    if (existing) {
      if (existing.isGuest === user.isAnonymous) return existing;
      return this.prisma.profile.update({
        where: { id: user.id },
        data: { isGuest: user.isAnonymous },
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.profile.create({
          data: { id: user.id, isGuest: user.isAnonymous },
        });
        await credit(tx, user.id, WELCOME_COINS, 'WELCOME');
        return tx.profile.findUniqueOrThrow({ where: { id: user.id } });
      });
    } catch (error) {
      // Duas requisições simultâneas do primeiro acesso: a outra criou primeiro.
      if (!isUniqueViolation(error)) throw error;
      return this.prisma.profile.findUniqueOrThrow({ where: { id: user.id } });
    }
  }

  /**
   * Bônus de quem entra no jogo: uma vez por dia (calendário de São Paulo).
   * O UPDATE condicional garante um único crédito mesmo com chamadas simultâneas.
   * Devolve quanto foi creditado agora (0 se já recebeu hoje).
   */
  claimDaily(userId: string, now = new Date()): Promise<number> {
    const today = saoPauloDay(now);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.profile.updateMany({
        where: {
          id: userId,
          OR: [{ lastDailyBonusOn: null }, { lastDailyBonusOn: { lt: today } }],
        },
        data: { coins: { increment: DAILY_COINS }, lastDailyBonusOn: today },
      });
      if (claimed.count !== 1) return 0;
      await tx.coinTransaction.create({
        data: { userId, amount: DAILY_COINS, reason: 'DAILY' },
      });
      return DAILY_COINS;
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

  /** Partidas, vitórias, pontos e as últimas movimentações de moedas (sem a posição no ranking). */
  async stats(userId: string): Promise<Omit<ProfileStats, 'rank'>> {
    const [profile, wins, history] = await Promise.all([
      this.prisma.profile.findUniqueOrThrow({ where: { id: userId } }),
      this.prisma.game.count({
        where: { winnerId: userId, status: 'FINISHED' },
      }),
      this.prisma.coinTransaction.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: COIN_HISTORY_LIMIT,
      }),
    ]);
    return {
      gamesPlayed: profile.gamesPlayed,
      wins,
      points: profile.points,
      coinHistory: history.map((t) => ({
        id: t.id,
        amount: t.amount,
        reason: t.reason,
        createdAt: t.createdAt.toISOString(),
      })),
    };
  }

  toDto(row: ProfileRow): Profile {
    return {
      id: row.id,
      nickname: row.nickname,
      isGuest: row.isGuest,
      points: row.points,
      coins: row.coins,
    };
  }
}
