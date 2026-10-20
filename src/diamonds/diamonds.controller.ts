import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  diamondExchangeSchema,
  type DiamondClaimResponse,
  type DiamondExchangeInput,
  type DiamondExchangeResponse,
  type DiamondStatus,
} from '../contracts';
import { CurrentUser } from '../core/auth/current-user.decorator';
import { HttpAuthGuard } from '../core/auth/http-auth.guard';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { ZodPipe } from '../core/zod.pipe';
import { ProfilesService } from '../profiles/profiles.service';
import { DiamondsService } from './diamonds.service';

@Controller('diamonds')
@UseGuards(HttpAuthGuard)
export class DiamondsController {
  constructor(
    private readonly diamonds: DiamondsService,
    private readonly profiles: ProfilesService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async status(@CurrentUser() user: AuthUser): Promise<DiamondStatus> {
    await this.profiles.ensure(user);
    return this.diamonds.status(user.id);
  }

  @Post('claim')
  @HttpCode(200)
  async claim(@CurrentUser() user: AuthUser): Promise<DiamondClaimResponse> {
    await this.profiles.ensure(user);
    return this.diamonds.claim(user.id);
  }

  @Post('exchange')
  @HttpCode(200)
  exchange(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(diamondExchangeSchema)) body: DiamondExchangeInput,
  ): Promise<DiamondExchangeResponse> {
    return this.diamonds.exchange(user.id, body.diamonds);
  }
}
