// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketDamasPublisher, DAMAS_PUBLISHER } from './damas-publisher';
import { DAMAS_CONFIG, DamasRoomsService } from './damas-rooms.service';
import { DamasGateway } from './damas.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketDamasPublisher,
    { provide: DAMAS_PUBLISHER, useExisting: SocketDamasPublisher },
    {
      provide: DAMAS_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.DAMAS_RECONNECT_GRACE_MS,
        maxRooms: env.DAMAS_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    DamasRoomsService,
    DamasGateway,
  ],
  exports: [DamasRoomsService],
})
export class DamasModule {}
