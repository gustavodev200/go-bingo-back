import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { rankingQuerySchema, type RankingResponse } from '../contracts';
import { CurrentUser } from '../core/auth/current-user.decorator';
import { HttpAuthGuard } from '../core/auth/http-auth.guard';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { ZodPipe } from '../core/zod.pipe';
import { RankingService } from './ranking.service';

@Controller('ranking')
@UseGuards(HttpAuthGuard)
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Get()
  @Header('Cache-Control', 'private, max-age=60')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(rankingQuerySchema)) query: { cursor: number },
  ): Promise<RankingResponse> {
    return this.ranking.list(user.id, query.cursor);
  }
}
