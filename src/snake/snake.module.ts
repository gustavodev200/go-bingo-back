// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ArenaModule } from '../arena/arena.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SNAKE_PUBLISHER, SocketSnakePublisher } from './snake-publisher';
import { SNAKE_CONFIG, SnakeRoomsService } from './snake-rooms.service';
import { SnakeGateway } from './snake.gateway';

@Module({
  imports: [ProfilesModule, ArenaModule],
  providers: [
    SocketSnakePublisher,
    { provide: SNAKE_PUBLISHER, useExisting: SocketSnakePublisher },
    {
      provide: SNAKE_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        reconnectGraceMs: env.SNAKE_RECONNECT_GRACE_MS,
        maxRooms: env.SNAKE_MAX_ROOMS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    SnakeRoomsService,
    SnakeGateway,
  ],
  exports: [SnakeRoomsService],
})
export class SnakeModule {}
