// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { INF_PUBLISHER, SocketInfPublisher } from './infiltrado-publisher';
import { INF_CONFIG, InfRoomsService } from './infiltrado-rooms.service';
import { InfGateway } from './infiltrado.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketInfPublisher,
    { provide: INF_PUBLISHER, useExisting: SocketInfPublisher },
    {
      provide: INF_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.INF_RECONNECT_GRACE_MS,
        maxRooms: env.INF_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    InfRoomsService,
    InfGateway,
  ],
  exports: [InfRoomsService],
})
export class InfiltradoModule {}
