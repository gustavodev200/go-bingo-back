import { Injectable } from '@nestjs/common';
import { remainingFor, type RoomSnapshot } from '../contracts';
import { DomainError } from '../core/domain-error';
import { PrismaService } from '../core/prisma.service';
import { GamesService } from './games.service';
import { PresenceService } from './presence.service';

@Injectable()
export class SnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly games: GamesService,
    private readonly presence: PresenceService,
  ) {}

  async build(code: string, viewerId: string): Promise<RoomSnapshot> {
    const room = await this.prisma.room.findUnique({
      where: { code },
      include: {
        members: { include: { profile: true }, orderBy: { slot: 'asc' } },
      },
    });
    if (!room || room.status === 'CLOSED')
      throw new DomainError('NOT_FOUND', 'Sala não encontrada');

    const game =
      room.status === 'IN_GAME'
        ? await this.prisma.game.findFirst({
            where: { roomId: room.id, status: 'IN_PROGRESS' },
          })
        : null;
    const cards = await this.prisma.card.findMany({
      where: { roomId: room.id, gameId: game?.id ?? null },
    });
    const cardByUser = new Map(cards.map((c) => [c.userId, c]));
    const drawn = game ? await this.games.drawnNumbers(game.id) : [];
    const drawnSet = new Set(drawn);
    const connected = this.presence.connectedSet(code);
    const mine = cardByUser.get(viewerId);

    return {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      isPublic: room.isPublic,
      status: room.status,
      winPattern: room.winPattern,
      members: room.members.map((m) => ({
        userId: m.userId,
        nickname: m.profile.nickname ?? 'Jogador',
        character: m.profile.character,
        slot: m.slot,
        isGuest: m.profile.isGuest,
        connected: connected.has(m.userId),
        hasCard: cardByUser.has(m.userId),
      })),
      myCard: mine
        ? { id: mine.id, grid: mine.grid, marked: [...new Set(mine.marked)] }
        : null,
      game: game
        ? {
            id: game.id,
            drawn,
            drawIntervalMs: room.drawIntervalMs,
            remaining: Object.fromEntries(
              cards.map((c) => [
                c.userId,
                remainingFor(room.winPattern, c.grid, drawnSet),
              ]),
            ),
          }
        : null,
    };
  }
}
