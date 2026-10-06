// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro); o service tem testes próprios.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { GuestCleanupService } from './guest-cleanup.service';

@Module({ providers: [GuestCleanupService] })
export class GuestsModule {}
