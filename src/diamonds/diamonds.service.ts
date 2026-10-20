import { Injectable } from '@nestjs/common';
import { saoPauloDay } from '../coins/ledger';
import {
  DIAMOND_PACKS,
  DIAMOND_STREAK_DAYS,
  DIAMONDS_DAILY,
  diamondRewardFor,
  type DiamondClaimResponse,
  type DiamondExchangeResponse,
  type DiamondReason,
  type DiamondStatus,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import { PrismaService } from '../core/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

interface DiamondRow {
  isGuest: boolean;
  coins: number;
  diamonds: number;
  diamondStreak: number;
  lastDiamondOn: Date | null;
}

/** Dia do ciclo que o próximo resgate paga, e se a sequência continua (resgatou ontem). */
export function nextClaimDay(
  row: Pick<DiamondRow, 'diamondStreak' | 'lastDiamondOn'>,
  today: Date,
): { day: number; claimedToday: boolean; shown: number } {
  const last = row.lastDiamondOn?.getTime() ?? null;
  const claimedToday = last === today.getTime();
  const continuing = last === today.getTime() - DAY_MS;
  const following = (row.diamondStreak % DIAMOND_STREAK_DAYS) + 1;
  if (claimedToday)
    return { day: following, claimedToday, shown: row.diamondStreak };
  if (continuing)
    return {
      day: following,
      claimedToday,
      shown: row.diamondStreak % DIAMOND_STREAK_DAYS,
    };
  return { day: 1, claimedToday, shown: 0 };
}

/**
 * Diamantes: resgate diário (uma vez por dia no calendário de São Paulo, só conta logada)
 * com ciclo de 7 dias seguidos, e troca por moedas em pacotes.
 */
@Injectable()
export class DiamondsService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string, now = new Date()): Promise<DiamondStatus> {
    const row = await this.prisma.profile.findUniqueOrThrow({
      where: { id: userId },
    });
    return toStatus(row, saoPauloDay(now));
  }

  /** Credita o resgate de hoje; 0 se já resgatou. O UPDATE condicional impede crédito duplo. */
  async claim(userId: string, now = new Date()): Promise<DiamondClaimResponse> {
    const today = saoPauloDay(now);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.profile.findUniqueOrThrow({ where: { id: userId } });
      if (row.isGuest)
        throw new DomainError(
          'GUEST_NOT_ALLOWED',
          'Entre com sua conta para ganhar diamantes',
        );
      const next = nextClaimDay(row, today);
      if (next.claimedToday)
        return { claimed: 0, status: toStatus(row, today) };
      const reward = diamondRewardFor(next.day);
      const updated = await tx.profile.updateMany({
        where: {
          id: userId,
          OR: [{ lastDiamondOn: null }, { lastDiamondOn: { lt: today } }],
        },
        data: {
          diamonds: { increment: reward },
          diamondStreak: next.day,
          lastDiamondOn: today,
        },
      });
      if (updated.count !== 1)
        return { claimed: 0, status: toStatus(row, today) };
      const rows: Array<{
        userId: string;
        amount: number;
        reason: DiamondReason;
      }> = [{ userId, amount: DIAMONDS_DAILY, reason: 'DAILY' }];
      if (reward > DIAMONDS_DAILY)
        rows.push({
          userId,
          amount: reward - DIAMONDS_DAILY,
          reason: 'STREAK',
        });
      await tx.diamondTransaction.createMany({ data: rows });
      const after = await tx.profile.findUniqueOrThrow({
        where: { id: userId },
      });
      return { claimed: reward, status: toStatus(after, today) };
    });
  }

  /** Troca um pacote de diamantes por moedas (pacote maior rende mais). */
  async exchange(
    userId: string,
    diamonds: number,
    now = new Date(),
  ): Promise<DiamondExchangeResponse> {
    const pack = DIAMOND_PACKS.find((p) => p.diamonds === diamonds);
    if (!pack) throw new DomainError('INVALID_PAYLOAD', 'Pacote inválido');
    return this.prisma.$transaction(async (tx) => {
      // Condicional no próprio UPDATE: duas trocas simultâneas não passam do saldo.
      const done = await tx.profile.updateMany({
        where: { id: userId, diamonds: { gte: pack.diamonds } },
        data: {
          diamonds: { decrement: pack.diamonds },
          coins: { increment: pack.coins },
        },
      });
      if (done.count !== 1)
        throw new DomainError(
          'INSUFFICIENT_DIAMONDS',
          `Você precisa de ${pack.diamonds} diamantes`,
        );
      await tx.diamondTransaction.create({
        data: { userId, amount: -pack.diamonds, reason: 'EXCHANGE' },
      });
      await tx.coinTransaction.create({
        data: { userId, amount: pack.coins, reason: 'EXCHANGE' },
      });
      const after = await tx.profile.findUniqueOrThrow({
        where: { id: userId },
      });
      return { coins: pack.coins, status: toStatus(after, saoPauloDay(now)) };
    });
  }
}

function toStatus(row: DiamondRow, today: Date): DiamondStatus {
  const next = nextClaimDay(row, today);
  return {
    diamonds: row.diamonds,
    coins: row.coins,
    streakDay: next.shown,
    claimedToday: next.claimedToday,
    nextReward: diamondRewardFor(next.day),
    eligible: !row.isGuest,
  };
}
