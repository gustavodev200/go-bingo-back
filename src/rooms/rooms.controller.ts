import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  createRoomSchema,
  roomCodeSchema,
  type CreateRoomInput,
  type PublicRoom,
} from '../contracts';
import { CurrentUser } from '../core/auth/current-user.decorator';
import { HttpAuthGuard } from '../core/auth/http-auth.guard';
import type { AuthUser } from '../core/auth/jwt-verifier';
import { DomainError } from '../core/domain-error';
import { ZodPipe } from '../core/zod.pipe';
import { RoomsService } from './rooms.service';

@Controller('rooms')
@UseGuards(HttpAuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(createRoomSchema)) body: CreateRoomInput,
  ) {
    return this.rooms.create(user.id, body);
  }

  @Get()
  list(): Promise<PublicRoom[]> {
    return this.rooms.listPublic();
  }

  @Get(':code')
  summary(@Param('code') raw: string): Promise<PublicRoom> {
    const parsed = roomCodeSchema.safeParse(raw);
    if (!parsed.success)
      throw new DomainError('NOT_FOUND', 'Sala não encontrada');
    return this.rooms.summary(parsed.data);
  }
}
