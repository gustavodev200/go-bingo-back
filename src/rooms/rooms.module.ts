// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); RoomsController/RoomsService têm specs.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
