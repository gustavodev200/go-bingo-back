// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider/controller listado aqui já é
// exercitado por seus próprios testes unitários, e a composição em si é
// validada pelos testes e2e, que de fato sobem a aplicação.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ArenaModule } from './arena/arena.module';
import { BomberModule } from './bomber/bomber.module';
import { CoreModule } from './core/core.module';
import { DiamondsModule } from './diamonds/diamonds.module';
import { DominoModule } from './domino/domino.module';
import { HttpThrottlerGuard } from './core/http-throttler.guard';
import { InfiltradoModule } from './infiltrado/infiltrado.module';
import { DamasModule } from './damas/damas.module';
import { BjModule } from './blackjack/blackjack.module';
import { TacadaModule } from './tacada/tacada.module';
import { GauderioModule } from './gauderio/gauderio.module';
import { GameModule } from './game/game.module';
import { GuestsModule } from './guests/guests.module';
import { HealthController } from './health/health.controller';
import { ProfilesModule } from './profiles/profiles.module';
import { RankingModule } from './ranking/ranking.module';
import { RoomsModule } from './rooms/rooms.module';
import { SnakeModule } from './snake/snake.module';
import { TrucoModule } from './truco/truco.module';
import { UnoModule } from './uno/uno.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    CoreModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ProfilesModule,
    RoomsModule,
    GameModule,
    RankingModule,
    ArenaModule,
    DiamondsModule,
    ScheduleModule.forRoot(),
    GuestsModule,
    TrucoModule,
    UnoModule,
    DominoModule,
    BomberModule,
    SnakeModule,
    InfiltradoModule,
    DamasModule,
    TacadaModule,
    GauderioModule,
    BjModule,
    VoiceModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
