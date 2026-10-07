import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_DRAW_INTERVAL_MS,
  type CreateRoomInput,
  type PublicRoom,
} from '../contracts';
import { ENV, type Env } from '../core/env';
import { DomainError } from '../core/domain-error';
import { isUniqueViolation } from '../core/prisma-errors';
import { PrismaService } from '../core/prisma.service';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { PresenceService } from '../game/presence.service';
import { generateRoomCode } from './room-code';

const CODE_ATTEMPTS = 5;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
    @Optional() private readonly presence?: PresenceService,
    @Optional()
    @Inject(ENV)
    private readonly env?: Pick<Env, 'DEFAULT_DRAW_INTERVAL_MS'>,
  ) {}

  async create(
    hostId: string,
    input: CreateRoomInput,
  ): Promise<{ code: string }> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: hostId },
    });
    if (!profile?.nickname)
      throw new DomainError(
        'NICKNAME_REQUIRED',
        'Escolha um apelido antes de criar uma sala',
      );

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = generateRoomCode(this.random);
      try {
        await this.prisma.room.create({
          data: {
            ...input,
            drawIntervalMs:
              input.drawIntervalMs ??
              this.env?.DEFAULT_DRAW_INTERVAL_MS ??
              DEFAULT_DRAW_INTERVAL_MS,
            code,
            hostId,
            members: { create: { userId: hostId, slot: 0 } },
          },
        });
        // O host agora é um RoomMember de verdade no banco, mas ainda não
        // abriu socket nenhum (ele chegou aqui via POST /rooms, não via
        // room:join) — sem presença nem timer, ficaria stuck pra sempre se
        // nunca conectar. Arma a janela de expiração desde já; se ele
        // conectar depois, presence.connect() cancela esse timer normalmente.
        this.presence?.armOffline(code, hostId);
        return { code };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new DomainError(
      'INTERNAL',
      'Não foi possível gerar um código de sala, tente de novo',
    );
  }

  async listPublic(): Promise<PublicRoom[]> {
    const rooms = await this.prisma.room.findMany({
      where: { isPublic: true, status: 'WAITING' },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rooms.map((r) => ({
      code: r.code,
      name: r.name,
      playerCount: r._count.members,
      maxPlayers: r.maxPlayers,
      status: r.status,
    }));
  }

  async summary(code: string): Promise<PublicRoom> {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: { _count: { select: { members: true } } },
    });
    if (!room || room.status === 'CLOSED')
      throw new DomainError('NOT_FOUND', 'Sala não encontrada');
    return {
      code: room.code,
      name: room.name,
      playerCount: room._count.members,
      maxPlayers: room.maxPlayers,
      status: room.status,
    };
  }
}
