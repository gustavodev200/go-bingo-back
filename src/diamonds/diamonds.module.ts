// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); DiamondsController/DiamondsService têm specs.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { DiamondsController } from './diamonds.controller';
import { DiamondsService } from './diamonds.service';

@Module({
  imports: [ProfilesModule],
  controllers: [DiamondsController],
  providers: [DiamondsService],
})
export class DiamondsModule {}
