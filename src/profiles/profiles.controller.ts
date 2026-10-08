import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  characterSchema,
  type CharacterId,
  type MeResponse,
  type Profile,
  type ProfileStats,
} from '../contracts';
import { CurrentUser } from '../core/auth/current-user.decorator';
import { HttpAuthGuard } from '../core/auth/http-auth.guard';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { ZodPipe } from '../core/zod.pipe';
import { RankingService } from '../ranking/ranking.service';
import { ProfilesService } from './profiles.service';

// O formato do apelido é validado no service (para mapear para NICKNAME_INVALID); aqui só o tipo.
const patchSchema = z
  .object({
    nickname: z.string().optional(),
    character: characterSchema.optional(),
  })
  .refine(
    (p) => p.nickname !== undefined || p.character !== undefined,
    'Nada para atualizar',
  );

@Controller('me')
@UseGuards(HttpAuthGuard)
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly ranking: RankingService,
  ) {}

  /** Abrir o jogo conta como "entrar no dia": credita o bônus diário uma vez por dia. */
  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    const profile = this.profiles.toDto(await this.profiles.ensure(user));
    const dailyBonus = await this.profiles.claimDaily(user.id);
    return { ...profile, coins: profile.coins + dailyBonus, dailyBonus };
  }

  @Get('stats')
  async stats(@CurrentUser() user: AuthUser): Promise<ProfileStats> {
    await this.profiles.ensure(user);
    const [stats, position] = await Promise.all([
      this.profiles.stats(user.id),
      this.ranking.position(user.id),
    ]);
    return { ...stats, rank: position?.rank ?? null };
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(patchSchema))
    body: { nickname?: string; character?: CharacterId },
  ): Promise<Profile> {
    return this.profiles.update(user, body);
  }
}
