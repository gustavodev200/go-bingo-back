import { Inject, Injectable } from '@nestjs/common';
import {
  FREE_CELL,
  FREE_INDEX,
  letterFor,
  remainingForFullCard,
  WIN_POINTS,
  type NumberDrawn,
  type Winner,
} from '../contracts';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { isUniqueViolation } from '../core/prisma-errors';
import { PrismaService } from '../core/prisma.service';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { generateGrid } from './card-generator';
import { pickNextNumber } from './draw';

export type DrawResult =
  | { kind: 'drawn'; draw: NumberDrawn }
  | { kind: 'exhausted' }
  | { kind: 'stopped' }
  | { kind: 'skipped' };

class ConcurrentDraw extends Error {}

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
  ) {}

  start(
    code: string,
    hostId: string,
  ): Promise<{ gameId: string; drawIntervalMs: number }> {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { code },
        include: { members: true, cards: { where: { gameId: null } } },
      });
      if (!room || room.status === 'CLOSED')
        throw new DomainError('NOT_FOUND', 'Sala não encontrada');
      if (room.hostId !== hostId)
        throw new DomainError('NOT_HOST', 'Só o host pode iniciar');
      if (room.status !== 'WAITING')
        throw new DomainError('INVALID_STATE', 'A partida já começou');

      const memberIds = room.members.map((m) => m.userId);
      const withCard = new Set(room.cards.map((c) => c.userId));
      if (
        memberIds.length < 2 ||
        memberIds.filter((id) => withCard.has(id)).length < 2
      ) {
        throw new DomainError(
          'NOT_ENOUGH_PLAYERS',
          'São necessários ao menos 2 jogadores com cartela',
        );
      }

      const flipped = await tx.room.updateMany({
        where: { id: room.id, status: 'WAITING' },
        data: { status: 'IN_GAME' },
      });
      if (flipped.count !== 1)
        throw new DomainError('INVALID_STATE', 'A partida já começou');

      const game = await tx.game.create({ data: { roomId: room.id } });
      await tx.card.updateMany({
        where: { roomId: room.id, gameId: null, userId: { in: memberIds } },
        data: { gameId: game.id },
      });
      const missing = memberIds.filter((id) => !withCard.has(id));
      if (missing.length > 0) {
        await tx.card.createMany({
          data: missing.map((userId) => ({
            roomId: room.id,
            userId,
            gameId: game.id,
            grid: generateGrid(this.random),
          })),
        });
      }
      await tx.roomMember.updateMany({
        where: { roomId: room.id },
        data: { cardRegens: 0 },
      });
      await tx.profile.updateMany({
        where: { id: { in: memberIds } },
        data: { gamesPlayed: { increment: 1 } },
      });
      return { gameId: game.id, drawIntervalMs: room.drawIntervalMs };
    });
  }

  async drawNext(gameId: string): Promise<DrawResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const game = await tx.game.findUnique({
          where: { id: gameId },
          include: { draws: { select: { number: true } } },
        });
        if (!game || game.status !== 'IN_PROGRESS')
          return { kind: 'stopped' } as const;

        const next = pickNextNumber(
          new Set(game.draws.map((d) => d.number)),
          this.random,
        );
        if (next === null) {
          await tx.game.update({
            where: { id: gameId },
            data: { status: 'FINISHED', finishedAt: new Date() },
          });
          await tx.room.update({
            where: { id: game.roomId },
            data: { status: 'WAITING' },
          });
          return { kind: 'exhausted' } as const;
        }

        const seq = game.drawnCount + 1;
        // Condicional: falha se outro tick sorteou antes ou se alguém fez bingo no meio.
        const bumped = await tx.game.updateMany({
          where: {
            id: gameId,
            status: 'IN_PROGRESS',
            drawnCount: game.drawnCount,
          },
          data: { drawnCount: seq },
        });
        if (bumped.count !== 1) throw new ConcurrentDraw();
        const draw = await tx.draw.create({
          data: { gameId, seq, number: next },
        });
        return {
          kind: 'drawn',
          draw: {
            seq,
            number: next,
            letter: letterFor(next),
            drawnAt: draw.drawnAt.toISOString(),
          },
        } as const;
      });
    } catch (error) {
      if (error instanceof ConcurrentDraw || isUniqueViolation(error))
        return { kind: 'skipped' };
      throw error;
    }
  }

  async mark(code: string, userId: string, index: number): Promise<number[]> {
    const { game, card } = await this.activeCard(code, userId);
    const number = card.grid[index];
    if (index === FREE_INDEX || number === FREE_CELL)
      return unique(card.marked);
    if (card.marked.includes(index)) return unique(card.marked);

    const drawn = await this.prisma.draw.findUnique({
      where: { gameId_number: { gameId: game.id, number } },
    });
    if (!drawn)
      throw new DomainError('NOT_DRAWN', 'Esse número ainda não saiu');
    const updated = await this.prisma.card.update({
      where: { id: card.id },
      data: { marked: { push: index } },
    });
    return unique(updated.marked);
  }

  async claim(
    code: string,
    user: AuthUser,
  ): Promise<{ gameId: string; winner: Winner }> {
    const { game, card } = await this.activeCard(code, user.id);
    const drawn = new Set(await this.drawnNumbers(game.id));
    if (remainingForFullCard(card.grid, drawn) > 0)
      throw new DomainError(
        'BINGO_INVALID',
        'Bingo inválido: ainda faltam números',
      );

    const pointsAwarded = user.isAnonymous ? 0 : WIN_POINTS;
    const winner = await this.prisma.$transaction(async (tx) => {
      const won = await tx.game.updateMany({
        where: { id: game.id, status: 'IN_PROGRESS', winnerId: null },
        data: { status: 'FINISHED', winnerId: user.id, finishedAt: new Date() },
      });
      if (won.count !== 1)
        throw new DomainError('BINGO_INVALID', 'Alguém fez bingo antes');
      await tx.room.update({
        where: { id: game.roomId },
        data: { status: 'WAITING' },
      });
      const profile = await tx.profile.update({
        where: { id: user.id },
        data: pointsAwarded > 0 ? { points: { increment: pointsAwarded } } : {},
      });
      return {
        userId: user.id,
        nickname: profile.nickname ?? 'Jogador',
        pointsAwarded,
        grid: card.grid,
      };
    });
    return { gameId: game.id, winner };
  }

  async progress(gameId: string): Promise<Record<string, number>> {
    const [cards, drawn] = await Promise.all([
      this.prisma.card.findMany({
        where: { gameId },
        select: { userId: true, grid: true },
      }),
      this.drawnNumbers(gameId),
    ]);
    const set = new Set(drawn);
    return Object.fromEntries(
      cards.map((c) => [c.userId, remainingForFullCard(c.grid, set)]),
    );
  }

  async drawnNumbers(gameId: string): Promise<number[]> {
    const draws = await this.prisma.draw.findMany({
      where: { gameId },
      orderBy: { seq: 'asc' },
      select: { number: true },
    });
    return draws.map((d) => d.number);
  }

  async findInProgress(): Promise<
    Array<{ id: string; roomCode: string; drawIntervalMs: number }>
  > {
    const games = await this.prisma.game.findMany({
      where: { status: 'IN_PROGRESS' },
      include: { room: true },
    });
    return games.map((g) => ({
      id: g.id,
      roomCode: g.room.code,
      drawIntervalMs: g.room.drawIntervalMs,
    }));
  }

  private async activeCard(code: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { code } });
    if (!room || room.status === 'CLOSED')
      throw new DomainError('NOT_FOUND', 'Sala não encontrada');
    const game = await this.prisma.game.findFirst({
      where: { roomId: room.id, status: 'IN_PROGRESS' },
    });
    if (!game)
      throw new DomainError('INVALID_STATE', 'Nenhuma partida em andamento');
    const card = await this.prisma.card.findUnique({
      where: { gameId_userId: { gameId: game.id, userId } },
    });
    if (!card)
      throw new DomainError('NOT_IN_ROOM', 'Você não está nesta partida');
    return { game, card };
  }
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}
