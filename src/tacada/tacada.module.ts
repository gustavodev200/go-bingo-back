// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketTacadaPublisher, TACADA_PUBLISHER } from './tacada-publisher';
import { TACADA_CONFIG, TacadaRoomsService } from './tacada-rooms.service';
import { TacadaGateway } from './tacada.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketTacadaPublisher,
    { provide: TACADA_PUBLISHER, useExisting: SocketTacadaPublisher },
    {
      provide: TACADA_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.TACADA_RECONNECT_GRACE_MS,
        maxRooms: env.TACADA_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    TacadaRoomsService,
    TacadaGateway,
  ],
  exports: [TacadaRoomsService],
})
export class TacadaModule {}
