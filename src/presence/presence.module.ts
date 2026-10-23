// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); o gateway tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { PresenceGateway } from './presence.gateway';

@Module({ providers: [PresenceGateway] })
export class PresenceModule {}
