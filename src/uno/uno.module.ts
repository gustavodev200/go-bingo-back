// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketUnoPublisher, UNO_PUBLISHER } from './uno-publisher';
import { UNO_CONFIG, UnoRoomsService } from './uno-rooms.service';
import { UnoGateway } from './uno.gateway';

@Module({
  imports: [ProfilesModule],
  providers: [
    SocketUnoPublisher,
    { provide: UNO_PUBLISHER, useExisting: SocketUnoPublisher },
    {
      provide: UNO_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.UNO_RECONNECT_GRACE_MS,
        turnMs: env.UNO_TURN_MS,
        roundPauseMs: env.UNO_ROUND_PAUSE_MS,
        maxRooms: env.UNO_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    UnoRoomsService,
    UnoGateway,
  ],
  exports: [UnoRoomsService],
})
export class UnoModule {}
