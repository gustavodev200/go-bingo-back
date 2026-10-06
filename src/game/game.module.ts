import { Module } from '@nestjs/common';
import { RoomsModule } from '../rooms/rooms.module';
import { DRAW_TIMER, realDrawTimer } from './draw-timer';
import { GameRunner } from './game-runner.service';
import { GamesService } from './games.service';
import { MembershipService } from './membership.service';
import { PresenceService } from './presence.service';
import { RealtimePublisher } from './realtime-publisher';
import { SnapshotService } from './snapshot.service';

@Module({
  imports: [RoomsModule],
  providers: [
    MembershipService,
    GamesService,
    PresenceService,
    RealtimePublisher,
    SnapshotService,
    GameRunner,
    { provide: DRAW_TIMER, useValue: realDrawTimer },
  ],
  exports: [MembershipService, GamesService],
})
export class GameModule {}
