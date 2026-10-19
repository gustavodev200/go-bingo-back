// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketTrucoPublisher, TRUCO_PUBLISHER } from './truco-publisher';
import { TRUCO_CONFIG, TrucoRoomsService } from './truco-rooms.service';
import { TrucoGateway } from './truco.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketTrucoPublisher,
    { provide: TRUCO_PUBLISHER, useExisting: SocketTrucoPublisher },
    {
      provide: TRUCO_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.TRUCO_RECONNECT_GRACE_MS,
        handPauseMs: env.TRUCO_HAND_PAUSE_MS,
        maxRooms: env.TRUCO_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    TrucoRoomsService,
    TrucoGateway,
  ],
  exports: [TrucoRoomsService],
})
export class TrucoModule {}
