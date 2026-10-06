// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); ProfilesController/ProfilesService têm specs.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
