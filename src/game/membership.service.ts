import { Inject, Injectable } from '@nestjs/common';
import { MAX_CARD_REGENS, type Card } from '../contracts';
import { DomainError } from '../core/domain-error';
import { isUniqueViolation } from '../core/prisma-errors';
import { PrismaService } from '../core/prisma.service';
import { RANDOM_INT, type RandomInt } from '../core/random';
import type { Prisma } from '../generated/prisma/client';
import { generateGrid } from './card-generator';
import { firstFreeSlot } from './slots';

export interface LeaveResult {
  removed: boolean;
  closed: boolean;
  newHostId?: string;
}

const JOIN_ATTEMPTS = 5;

@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
  ) {}

  async join(code: string, userId: string): Promise<void> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });
    if (!profile?.nickname)
      throw new DomainError(
        'NICKNAME_REQUIRED',
        'Escolha um apelido antes de entrar',
      );

    const room = await this.openRoom(code);
    for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt++) {
      const members = await this.prisma.roomMember.findMany({
        where: { roomId: room.id },
        select: { userId: true, slot: true },
      });
      if (members.some((m) => m.userId === userId)) return;
      if (room.status === 'IN_GAME')
        throw new DomainError('GAME_IN_PROGRESS', 'Partida em andamento');
      const slot = firstFreeSlot(
        new Set(members.map((m) => m.slot)),
        room.maxPlayers,
      );
      if (slot === null) throw new DomainError('ROOM_FULL', 'Sala cheia');
      try {
        await this.prisma.roomMember.create({
          data: { roomId: room.id, userId, slot },
        });
        return;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new DomainError('ROOM_FULL', 'Sala cheia');
  }

  leave(code: string, userId: string): Promise<LeaveResult> {
    return this.prisma.$transaction(async (tx) => {
      // Lock + leitura da sala numa única instrução: isso serializa leaves/
      // kicks concorrentes na mesma sala E garante que o hostId usado abaixo
      // já reflete qualquer transferência que a outra transação tenha
      // comitado. Um lock sem reler o hostId (ou lido antes do lock) não
      // resolve: a transação que fica bloqueada retomaria com um hostId
      // obtido antes do commit da outra, decidindo a transferência com base
      // em estado stale — podendo deixar a sala com hostId apontando para
      // alguém que também acabou de sair nesse mesmo instante.
      const [room] = await tx.$queryRaw<
        { id: string; hostId: string; status: string }[]
      >`SELECT "id", "hostId", "status" FROM "Room" WHERE "code" = ${code} FOR UPDATE`;
      if (!room || room.status === 'CLOSED')
        return { removed: false, closed: false };

      const deleted = await tx.roomMember.deleteMany({
        where: { roomId: room.id, userId },
      });
      if (deleted.count === 0) return { removed: false, closed: false };
      await tx.card.deleteMany({
        where: { roomId: room.id, userId, gameId: null },
      });

      const remaining = await tx.roomMember.findMany({
        where: { roomId: room.id },
        orderBy: { joinedAt: 'asc' },
      });
      if (remaining.length === 0) {
        await this.closeRoom(tx, room.id);
        return { removed: true, closed: true };
      }
      if (room.hostId === userId) {
        await tx.room.update({
          where: { id: room.id },
          data: { hostId: remaining[0].userId },
        });
        return { removed: true, closed: false, newHostId: remaining[0].userId };
      }
      return { removed: true, closed: false };
    });
  }

  async kick(
    code: string,
    hostId: string,
    targetId: string,
  ): Promise<LeaveResult> {
    await this.assertHost(code, hostId);
    if (targetId === hostId)
      throw new DomainError(
        'INVALID_STATE',
        'O host não pode remover a si mesmo',
      );
    return this.leave(code, targetId);
  }

  async cancel(code: string, hostId: string): Promise<void> {
    const room = await this.assertHost(code, hostId);
    await this.prisma.$transaction((tx) => this.closeRoom(tx, room.id));
  }

  async assertHost(code: string, userId: string) {
    const room = await this.openRoom(code);
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o host pode fazer isso');
    return room;
  }

  async generateCard(code: string, userId: string): Promise<Card> {
    const room = await this.openRoom(code);
    if (room.status !== 'WAITING')
      throw new DomainError('INVALID_STATE', 'A partida já começou');
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    });
    if (!member)
      throw new DomainError('NOT_IN_ROOM', 'Você não está nesta sala');

    const grid = generateGrid(this.random);
    const existing = await this.prisma.card.findFirst({
      where: { roomId: room.id, userId, gameId: null },
    });
    if (!existing) {
      const created = await this.prisma.card.create({
        data: { roomId: room.id, userId, grid },
      });
      return { id: created.id, grid: created.grid, marked: [] };
    }
    if (member.cardRegens >= MAX_CARD_REGENS)
      throw new DomainError(
        'REGEN_LIMIT',
        `Você já trocou a cartela ${MAX_CARD_REGENS} vezes`,
      );

    const [, updated] = await this.prisma.$transaction([
      this.prisma.roomMember.update({
        where: { roomId_userId: { roomId: room.id, userId } },
        data: { cardRegens: { increment: 1 } },
      }),
      this.prisma.card.update({
        where: { id: existing.id },
        data: { grid, marked: [] },
      }),
    ]);
    return { id: updated.id, grid: updated.grid, marked: [] };
  }

  private async openRoom(code: string) {
    const room = await this.prisma.room.findUnique({ where: { code } });
    if (!room || room.status === 'CLOSED')
      throw new DomainError('NOT_FOUND', 'Sala não encontrada');
    return room;
  }

  private async closeRoom(
    tx: Prisma.TransactionClient,
    roomId: string,
  ): Promise<void> {
    await tx.room.update({ where: { id: roomId }, data: { status: 'CLOSED' } });
    await tx.game.updateMany({
      where: { roomId, status: 'IN_PROGRESS' },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }
}
