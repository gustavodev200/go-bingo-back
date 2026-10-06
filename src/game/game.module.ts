// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); cada provider listado já tem spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { RoomsModule } from '../rooms/rooms.module';
import { DRAW_TIMER, realDrawTimer } from './draw-timer';
import { GameGateway } from './game.gateway';
import { GameRunner } from './game-runner.service';
import { GamesService } from './games.service';
import { MembershipService } from './membership.service';
import { PresenceService } from './presence.service';
import { RealtimePublisher } from './realtime-publisher';
import { SnapshotService } from './snapshot.service';

@Module({
  imports: [RoomsModule, ProfilesModule],
  providers: [
    MembershipService,
    GamesService,
    PresenceService,
    RealtimePublisher,
    SnapshotService,
    GameRunner,
    GameGateway,
    { provide: DRAW_TIMER, useValue: realDrawTimer },
  ],
  exports: [MembershipService, GamesService],
})
export class GameModule {}
