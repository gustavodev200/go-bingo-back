import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import type { Profile } from '../contracts';
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

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<Profile> {
    return this.profiles.toDto(await this.profiles.ensure(user));
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(patchSchema)) body: { nickname: string },
  ): Promise<Profile> {
    return this.profiles.setNickname(user, body.nickname);
  }
}
