// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../core/env';
import { DRAW_TIMER, realDrawTimer } from '../game/draw-timer';
import { ProfilesModule } from '../profiles/profiles.module';
import { SNAKE_CONFIG, SnakeArenasService } from './snake-arenas.service';
import { SNAKE_PUBLISHER, SocketSnakePublisher } from './snake-publisher';
import { SnakeGateway } from './snake.gateway';

@Module({
  imports: [ProfilesModule],
  providers: [
    SocketSnakePublisher,
    { provide: SNAKE_PUBLISHER, useExisting: SocketSnakePublisher },
    {
      provide: SNAKE_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => ({
        bots: env.SNAKE_BOTS,
        maxPlayers: env.SNAKE_MAX_PLAYERS,
        maxArenas: env.SNAKE_MAX_ARENAS,
      }),
    },
    { provide: DRAW_TIMER, useValue: realDrawTimer },
    SnakeArenasService,
    SnakeGateway,
  ],
  exports: [SnakeArenasService],
})
export class SnakeModule {}
