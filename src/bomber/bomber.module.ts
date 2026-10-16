// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesModule } from '../profiles/profiles.module';
import { BOMBER_PUBLISHER, SocketBomberPublisher } from './bomber-publisher';
import { BOMBER_CONFIG, BomberRoomsService } from './bomber-rooms.service';
import { BomberGateway } from './bomber.gateway';

@Module({
  imports: [ProfilesModule],
  providers: [
    SocketBomberPublisher,
    { provide: BOMBER_PUBLISHER, useExisting: SocketBomberPublisher },
    {
      provide: BOMBER_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.BOMBER_RECONNECT_GRACE_MS,
        roundPauseMs: env.BOMBER_ROUND_PAUSE_MS,
        maxRooms: env.BOMBER_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    BomberRoomsService,
    BomberGateway,
  ],
  exports: [BomberRoomsService],
})
export class BomberModule {}
