import { Module } from '@nestjs/common';
import { GamesService } from './games.service';
import { MembershipService } from './membership.service';

@Module({
  providers: [MembershipService, GamesService],
  exports: [MembershipService, GamesService],
})
export class GameModule {}
