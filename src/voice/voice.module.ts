// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); gateway e canais têm spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { DEFAULT_VOICE_ICE_SERVERS } from '../contracts';
import { ENV, type Env } from '../core/env';
import { BjRoomsService } from '../blackjack/blackjack-rooms.service';
import { BjModule } from '../blackjack/blackjack.module';
import { DamasRoomsService } from '../damas/damas-rooms.service';
import { DamasModule } from '../damas/damas.module';
import { DominoRoomsService } from '../domino/domino-rooms.service';
import { DominoModule } from '../domino/domino.module';
import { GameModule } from '../game/game.module';
import { InfRoomsService } from '../infiltrado/infiltrado-rooms.service';
import { InfiltradoModule } from '../infiltrado/infiltrado.module';
import { MembershipService } from '../game/membership.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { TrucoRoomsService } from '../truco/truco-rooms.service';
import { TrucoModule } from '../truco/truco.module';
import { UnoRoomsService } from '../uno/uno-rooms.service';
import { UnoModule } from '../uno/uno.module';
import { VoiceChannelsService } from './voice-channels.service';
import {
  VOICE_CONFIG,
  VOICE_MEMBERSHIP,
  VoiceGateway,
  type VoiceConfig,
  type VoiceMembership,
} from './voice.gateway';

@Module({
  imports: [
    ProfilesModule,
    GameModule,
    TrucoModule,
    UnoModule,
    DominoModule,
    DamasModule,
    BjModule,
    InfiltradoModule,
  ],
  providers: [
    VoiceChannelsService,
    {
      provide: VOICE_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): VoiceConfig => ({
        iceServers: env.VOICE_ICE_SERVERS ?? DEFAULT_VOICE_ICE_SERVERS,
        sweepMs: 10_000,
      }),
    },
    {
      provide: VOICE_MEMBERSHIP,
      inject: [
        MembershipService,
        TrucoRoomsService,
        UnoRoomsService,
        DominoRoomsService,
        DamasRoomsService,
        BjRoomsService,
        InfRoomsService,
      ],
      useFactory: (
        bingo: MembershipService,
        truco: TrucoRoomsService,
        uno: UnoRoomsService,
        domino: DominoRoomsService,
        damas: DamasRoomsService,
        blackjack: BjRoomsService,
        inf: InfRoomsService,
      ): VoiceMembership => ({
        isMember: (game, code, userId) => {
          if (game === 'infiltrado')
            return Promise.resolve(inf.canTalk(code, userId));
          if (game === 'truco')
            return Promise.resolve(truco.roomOf(userId) === code);
          if (game === 'uno')
            return Promise.resolve(uno.roomOf(userId) === code);
          if (game === 'domino')
            return Promise.resolve(domino.roomOf(userId) === code);
          if (game === 'damas')
            return Promise.resolve(damas.roomOf(userId) === code);
          if (game === 'blackjack')
            return Promise.resolve(blackjack.roomOf(userId) === code);
          return bingo.isMember(code, userId);
        },
      }),
    },
    VoiceGateway,
    {
      // When an Infiltrado meeting closes, its voice channel closes right away (not at the next sweep).
      provide: 'INF_VOICE_BRIDGE',
      inject: [InfRoomsService, VoiceGateway],
      useFactory: (inf: InfRoomsService, voice: VoiceGateway) =>
        inf.onVoiceRightsChanged(
          (code) => void voice.sweep({ game: 'infiltrado', code }),
        ),
    },
  ],
})
export class VoiceModule {}
