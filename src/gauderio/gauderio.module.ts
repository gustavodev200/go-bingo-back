// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocketGaudPublisher, GAUD_PUBLISHER } from './gauderio-publisher';
import { GAUD_CONFIG, GaudRoomsService } from './gauderio-rooms.service';
import { GaudGateway } from './gauderio.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketGaudPublisher,
    { provide: GAUD_PUBLISHER, useExisting: SocketGaudPublisher },
    {
      provide: GAUD_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.GAUDERIO_RECONNECT_GRACE_MS,
        handPauseMs: env.GAUDERIO_HAND_PAUSE_MS,
        maxRooms: env.GAUDERIO_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    GaudRoomsService,
    GaudGateway,
  ],
  exports: [GaudRoomsService],
})
export class GauderioModule {}
