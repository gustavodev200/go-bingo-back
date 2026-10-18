// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketDominoPublisher, DOMINO_PUBLISHER } from './domino-publisher';
import { DOMINO_CONFIG, DominoRoomsService } from './domino-rooms.service';
import { DominoGateway } from './domino.gateway';

@Module({
  imports: [ProfilesModule],
  providers: [
    SocketDominoPublisher,
    { provide: DOMINO_PUBLISHER, useExisting: SocketDominoPublisher },
    {
      provide: DOMINO_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.DOMINO_RECONNECT_GRACE_MS,
        turnMs: env.DOMINO_TURN_MS,
        roundPauseMs: env.DOMINO_ROUND_PAUSE_MS,
        maxRooms: env.DOMINO_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    DominoRoomsService,
    DominoGateway,
  ],
  exports: [DominoRoomsService],
})
export class DominoModule {}
