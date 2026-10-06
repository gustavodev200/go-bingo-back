// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); PresenceService já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';

/**
 * Módulo dedicado só para poder exportar PresenceService sem criar um ciclo
 * de módulos: GameModule já importa RoomsModule, então RoomsService não pode
 * importar GameModule de volta para enxergar PresenceService. Como
 * PresenceService não tem dependências próprias (ver presence.service.ts),
 * isolá-lo aqui deixa tanto GameModule quanto RoomsModule importarem este
 * módulo "folha" sem nenhuma dependência circular.
 */
@Module({
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
