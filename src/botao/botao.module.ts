// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { BOTAO_PUBLISHER, SocketBotaoPublisher } from './botao-publisher';
import { BOTAO_CONFIG, BotaoRoomsService } from './botao-rooms.service';
import { BotaoGateway } from './botao.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketBotaoPublisher,
    { provide: BOTAO_PUBLISHER, useExisting: SocketBotaoPublisher },
    {
      provide: BOTAO_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.BOTAO_RECONNECT_GRACE_MS,
        maxRooms: env.BOTAO_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    BotaoRoomsService,
    BotaoGateway,
  ],
  exports: [BotaoRoomsService],
})
export class BotaoModule {}
