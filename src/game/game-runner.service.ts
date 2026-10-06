import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ServerEvents } from '../contracts';
import { PrismaService } from '../core/prisma.service';
import { DRAW_TIMER, type DrawTimer } from './draw-timer';
import { GamesService } from './games.service';
import { PresenceService } from './presence.service';
import { RealtimePublisher } from './realtime-publisher';
import { SnapshotService } from './snapshot.service';

@Injectable()
export class GameRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GameRunner.name);
  private readonly timers = new Map<string, unknown>();

  constructor(
    private readonly games: GamesService,
    private readonly snapshots: SnapshotService,
    private readonly publisher: RealtimePublisher,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    @Inject(DRAW_TIMER) private readonly timer: DrawTimer,
  ) {}

  async start(code: string, hostId: string): Promise<void> {
    const { gameId, drawIntervalMs } = await this.games.start(code, hostId);
    this.publisher.toRoom(code, ServerEvents.GAME_STARTED, {
      gameId,
      drawIntervalMs,
    });
    await this.broadcastSnapshots(code);
    this.publisher.publicRoomsChanged();
    this.schedule(gameId, code, drawIntervalMs);
  }

  async tick(gameId: string, code: string, intervalMs: number): Promise<void> {
    this.timers.delete(gameId);
    try {
      const result = await this.games.drawNext(gameId);
      if (result.kind === 'drawn') {
        this.publisher.toRoom(code, ServerEvents.NUMBER_DRAWN, result.draw);
        this.publisher.toRoom(code, ServerEvents.GAME_PROGRESS, {
          remaining: await this.games.progress(gameId),
        });
        this.schedule(gameId, code, intervalMs);
      } else if (result.kind === 'skipped') {
        this.schedule(gameId, code, intervalMs);
      } else if (result.kind === 'exhausted') {
        this.publisher.toRoom(code, ServerEvents.GAME_ENDED, {
          reason: 'exhausted',
        });
        this.publisher.publicRoomsChanged();
      }
    } catch (error) {
      this.logger.error(error);
      this.schedule(gameId, code, intervalMs);
    }
  }

  stop(gameId: string): void {
    const handle = this.timers.get(gameId);
    if (handle !== undefined) this.timer.clear(handle);
    this.timers.delete(gameId);
  }

  async broadcastSnapshots(code: string): Promise<void> {
    const members = await this.prisma.roomMember.findMany({
      where: { room: { code } },
      select: { userId: true },
    });
    await Promise.all(
      members.map(async ({ userId }) =>
        this.publisher.toUser(
          userId,
          ServerEvents.ROOM_STATE,
          await this.snapshots.build(code, userId),
        ),
      ),
    );
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const game of await this.games.findInProgress())
      this.schedule(game.id, game.roomCode, game.drawIntervalMs);

    // Presença é só em memória e é zerada a cada boot: qualquer RoomMember
    // de uma sala ainda aberta ficou sem presença nenhuma e sem timer de
    // expiração depois do restart. Sem isto, um host offline nunca é
    // substituído e a sala trava para sempre (host-transfer só acontece via
    // o caminho de expiração → removeMember). Arma a janela de graça para
    // cada um; quem reconectar cancela o timer normalmente em presence.connect().
    const members = await this.prisma.roomMember.findMany({
      where: { room: { status: { not: 'CLOSED' } } },
      select: { userId: true, room: { select: { code: true } } },
    });
    for (const member of members)
      this.presence.armOffline(member.room.code, member.userId);
  }

  onModuleDestroy(): void {
    for (const gameId of [...this.timers.keys()]) this.stop(gameId);
  }

  private schedule(gameId: string, code: string, intervalMs: number): void {
    this.stop(gameId);
    this.timers.set(
      gameId,
      this.timer.set(
        () => void this.tick(gameId, code, intervalMs),
        intervalMs,
      ),
    );
  }
}
