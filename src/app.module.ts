import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { HealthController } from './health/health.controller';
import { ProfilesModule } from './profiles/profiles.module';

@Module({
  imports: [CoreModule, ProfilesModule],
  controllers: [HealthController],
})
export class AppModule {}
