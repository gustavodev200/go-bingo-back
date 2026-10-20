import { Inject, Injectable } from '@nestjs/common';
import { ArenaService } from '../arena/arena.service';
import { chargeUpTo } from '../coins/ledger';
import {
  BINGO_CPU_IDS,
  bingoCpuName,
  CARD_COST,
  DEFAULT_WIN_PATTERN,
  isBingoCpu,
  FREE_CELL,
  FREE_INDEX,
  letterFor,
  remainingFor,
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
    private readonly arena: ArenaService,
  ) {}

  /** Quantas cartelas a CPU joga na próxima partida; só o host, só antes de começar. */
  async setCpus(code: string, hostId: string, count: number): Promise<void> {
    const room = await this.prisma.room.findUnique({ where: { code } });
    if (!room || room.status === 'CLOSED')
      throw new DomainError('NOT_FOUND', 'Sala não encontrada');
    if (room.hostId !== hostId)
      throw new DomainError('NOT_HOST', 'Só o host chama a CPU');
    if (room.status !== 'WAITING')
      throw new DomainError('INVALID_STATE', 'A partida já começou');
    await this.prisma.room.update({
      where: { id: room.id },
      data: { cpuPlayers: count },
    });
  }

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
      const cpus = BINGO_CPU_IDS.slice(0, room.cpuPlayers);
      // Com CPU, basta uma pessoa (todo mundo sem cartela recebe a automática).
      const people = cpus.length
        ? memberIds.length
        : memberIds.filter((id) => withCard.has(id)).length;
      if (memberIds.length + cpus.length < 2 || people + cpus.length < 2) {
        throw new DomainError(
          'NOT_ENOUGH_PLAYERS',
          'São necessários ao menos 2 jogadores com cartela (ou chame a CPU)',
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
        // A cartela automática também custa; quem não tem saldo joga mesmo assim (não trava a partida).
        await chargeUpTo(tx, missing, CARD_COST, 'CARD', game.id);
      }
      if (cpus.length > 0)
        await tx.card.createMany({
          data: cpus.map((userId) => ({
            roomId: room.id,
            userId,
            gameId: game.id,
            grid: generateGrid(this.random),
          })),
        });
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
          // Condicional: não sobrescreve um estado que claim() ou cancel()
          // já tenham decidido (bingo no último número, ou sala cancelada)
          // enquanto este tick ainda estava lendo o estado antigo.
          const finished = await tx.game.updateMany({
            where: { id: gameId, status: 'IN_PROGRESS' },
            data: { status: 'FINISHED', finishedAt: new Date() },
          });
          if (finished.count !== 1) return { kind: 'stopped' } as const;
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
    const { room, game, card } = await this.activeCard(code, user.id);
    const drawn = new Set(await this.drawnNumbers(game.id));
    if (remainingFor(room.winPattern, card.grid, drawn) > 0)
      throw new DomainError(
        'BINGO_INVALID',
        'Bingo inválido: ainda faltam números',
      );

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
      const others = await tx.card.findMany({
        where: { gameId: game.id, userId: { not: user.id } },
        select: { userId: true },
      });
      const cpuPlayers = others.filter((c) => isBingoCpu(c.userId)).length;
      const losers = others.filter((c) => !isBingoCpu(c.userId));
      // Arena: todo mundo que tinha cartela entra no pote (inclusive quem saiu no meio);
      // pontos só contam entre jogadores logados. Com CPU na mesa: sem pote, só o agrado fixo.
      const results = await this.arena.settleIn(tx, {
        matchId: game.id,
        game: 'BINGO',
        durationMs: Date.now() - game.startedAt.getTime(),
        bonusScale: room.winPattern === 'LINE' ? 0.5 : 1,
        stake: room.stake,
        skipGamesPlayed: true,
        cpuPlayers,
        participants: [
          { userId: user.id, placement: 1 },
          ...losers.map((c) => ({ userId: c.userId, placement: 2 })),
        ],
      });
      const mine = results?.get(user.id);
      const profile = await tx.profile.findUniqueOrThrow({
        where: { id: user.id },
      });
      return {
        userId: user.id,
        nickname: profile.nickname ?? 'Jogador',
        pointsAwarded: Math.max(mine?.pointsDelta ?? 0, 0),
        coinsAwarded: Math.max(mine?.coinsDelta ?? 0, 0),
        grid: card.grid,
      };
    });
    return { gameId: game.id, winner };
  }

  /**
   * A CPU confere as cartelas dela antes de cada sorteio: se alguma completou (e ninguém
   * gritou antes), ela faz bingo. Fecha a partida e liquida as pessoas como derrota contra a CPU.
   */
  async cpuBingo(gameId: string): Promise<Winner | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { room: true },
    });
    if (!game || game.status !== 'IN_PROGRESS' || game.room.cpuPlayers === 0)
      return null;
    const drawn = new Set(await this.drawnNumbers(gameId));
    const cards = await this.prisma.card.findMany({
      where: { gameId },
      select: { userId: true, grid: true },
    });
    const done = cards.find(
      (c) =>
        isBingoCpu(c.userId) &&
        remainingFor(game.room.winPattern, c.grid, drawn) === 0,
    );
    if (!done) return null;
    return this.prisma.$transaction(async (tx) => {
      const won = await tx.game.updateMany({
        where: { id: gameId, status: 'IN_PROGRESS', winnerId: null },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      if (won.count !== 1) return null;
      await tx.room.update({
        where: { id: game.roomId },
        data: { status: 'WAITING' },
      });
      await this.arena.settleIn(tx, {
        matchId: gameId,
        game: 'BINGO',
        durationMs: Date.now() - game.startedAt.getTime(),
        skipGamesPlayed: true,
        cpuPlayers: cards.filter((c) => isBingoCpu(c.userId)).length,
        participants: cards
          .filter((c) => !isBingoCpu(c.userId))
          .map((c) => ({ userId: c.userId, placement: 2 })),
      });
      return {
        userId: done.userId,
        nickname: bingoCpuName(done.userId)!,
        pointsAwarded: 0,
        coinsAwarded: 0,
        grid: done.grid,
      };
    });
  }

  async progress(gameId: string): Promise<Record<string, number>> {
    const [game, cards, drawn] = await Promise.all([
      this.prisma.game.findUnique({
        where: { id: gameId },
        select: { room: { select: { winPattern: true } } },
      }),
      this.prisma.card.findMany({
        where: { gameId },
        select: { userId: true, grid: true },
      }),
      this.drawnNumbers(gameId),
    ]);
    const set = new Set(drawn);
    const pattern = game?.room.winPattern ?? DEFAULT_WIN_PATTERN;
    return Object.fromEntries(
      cards.map((c) => [c.userId, remainingFor(pattern, c.grid, set)]),
    );
  }

  /**
   * Encerra a partida sem vencedor quando nenhum membro atual tem cartela dela
   * (só sobraram espectadores). Devolve o id do jogo encerrado, ou null.
   */
  endIfNoPlayers(code: string): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { code },
        include: { members: { select: { userId: true } } },
      });
      if (!room || room.status !== 'IN_GAME') return null;
      const game = await tx.game.findFirst({
        where: { roomId: room.id, status: 'IN_PROGRESS' },
      });
      if (!game) return null;
      const players = await tx.card.count({
        where: {
          gameId: game.id,
          userId: { in: room.members.map((m) => m.userId) },
        },
      });
      if (players > 0) return null;
      // Condicional: não sobrescreve um bingo ou fim por exaustão decidido em paralelo.
      const ended = await tx.game.updateMany({
        where: { id: game.id, status: 'IN_PROGRESS' },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      if (ended.count !== 1) return null;
      await tx.room.update({
        where: { id: room.id },
        data: { status: 'WAITING' },
      });
      return game.id;
    });
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
    // Cartas de jogo não são apagadas por leave()/kick() (só as de lobby),
    // então um jogador removido mid-game ainda teria uma Card válida aqui.
    // Exige membership atual para fechar essa brecha de pontos.
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    });
    if (!member)
      throw new DomainError('NOT_IN_ROOM', 'Você não está nesta partida');
    const card = await this.prisma.card.findUnique({
      where: { gameId_userId: { gameId: game.id, userId } },
    });
    if (!card)
      throw new DomainError('NOT_IN_ROOM', 'Você não está nesta partida');
    return { room, game, card };
  }
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}
