// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketBjPublisher, BJ_PUBLISHER } from './blackjack-publisher';
import { BJ_CONFIG, BjRoomsService } from './blackjack-rooms.service';
import { BjGateway } from './blackjack.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketBjPublisher,
    { provide: BJ_PUBLISHER, useExisting: SocketBjPublisher },
    {
      provide: BJ_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.BLACKJACK_RECONNECT_GRACE_MS,
        maxRooms: env.BLACKJACK_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    BjRoomsService,
    BjGateway,
  ],
  exports: [BjRoomsService],
})
export class BjModule {}
