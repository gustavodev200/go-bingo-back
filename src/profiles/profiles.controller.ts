import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { MeResponse, Profile } from '../contracts';
import { CurrentUser } from '../core/auth/current-user.decorator';
import { HttpAuthGuard } from '../core/auth/http-auth.guard';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { ZodPipe } from '../core/zod.pipe';
import { ProfilesService } from './profiles.service';

// O formato do apelido é validado no service (para mapear para NICKNAME_INVALID); aqui só o tipo.
const patchSchema = z.object({ nickname: z.string() });

@Controller('me')
@UseGuards(HttpAuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  /** Abrir o jogo conta como "entrar no dia": credita o bônus diário uma vez por dia. */
  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    const profile = this.profiles.toDto(await this.profiles.ensure(user));
    const dailyBonus = await this.profiles.claimDaily(user.id);
    return { ...profile, coins: profile.coins + dailyBonus, dailyBonus };
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(patchSchema)) body: { nickname: string },
  ): Promise<Profile> {
    return this.profiles.setNickname(user, body.nickname);
  }
}
