import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { GameModule } from './game/game.module';
import { HealthController } from './health/health.controller';
import { ProfilesModule } from './profiles/profiles.module';
import { RoomsModule } from './rooms/rooms.module';

@Module({
  imports: [CoreModule, ProfilesModule, RoomsModule, GameModule],
  controllers: [HealthController],
})
export class AppModule {}
