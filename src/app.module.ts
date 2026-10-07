// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider/controller listado aqui já é
// exercitado por seus próprios testes unitários, e a composição em si é
// validada pelos testes e2e, que de fato sobem a aplicação.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core/core.module';
import { HttpThrottlerGuard } from './core/http-throttler.guard';
import { GameModule } from './game/game.module';
import { GuestsModule } from './guests/guests.module';
import { HealthController } from './health/health.controller';
import { ProfilesModule } from './profiles/profiles.module';
import { RankingModule } from './ranking/ranking.module';
import { RoomsModule } from './rooms/rooms.module';

@Module({
  imports: [
    CoreModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    ProfilesModule,
    RoomsModule,
    GameModule,
    RankingModule,
    ScheduleModule.forRoot(),
    GuestsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
