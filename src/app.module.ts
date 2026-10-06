import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core/core.module';
import { HttpThrottlerGuard } from './core/http-throttler.guard';
import { GameModule } from './game/game.module';
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
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: HttpThrottlerGuard }],
})
export class AppModule {}
