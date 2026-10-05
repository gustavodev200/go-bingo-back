import { Module } from '@nestjs/common';
import { MembershipService } from './membership.service';

@Module({
  providers: [MembershipService],
  exports: [MembershipService],
})
export class GameModule {}
