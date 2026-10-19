import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  latestResultQuerySchema,
  type LatestResultResponse,
} from '../contracts';
import { CurrentUser } from '../core/auth/current-user.decorator';
import { HttpAuthGuard } from '../core/auth/http-auth.guard';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { ZodPipe } from '../core/zod.pipe';
import { ArenaService } from './arena.service';

@Controller('arena')
@UseGuards(HttpAuthGuard)
export class ArenaController {
  constructor(private readonly arena: ArenaService) {}

  /** Último resultado do jogador; a tela de fim de partida espera o que for posterior a `since`. */
  @Get('latest')
  @Header('Cache-Control', 'no-store')
  async latest(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(latestResultQuerySchema)) query: { since?: string },
  ): Promise<LatestResultResponse> {
    const since = query.since ? new Date(query.since) : undefined;
    return {
      result: await this.arena.latest(user.id, since),
      now: new Date().toISOString(),
    };
  }
}
