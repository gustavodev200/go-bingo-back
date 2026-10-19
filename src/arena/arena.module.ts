// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); ArenaService/SeasonService/ArenaController têm specs.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ArenaController } from './arena.controller';
import { ArenaService } from './arena.service';
import { SeasonService } from './season.service';

@Module({
  controllers: [ArenaController],
  providers: [ArenaService, SeasonService],
  exports: [ArenaService],
})
export class ArenaModule {}
