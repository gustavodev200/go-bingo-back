// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); gateway e canais têm spec própria.
/* istanbul ignore file */
import { Module } from '@nestjs/common';
import { DEFAULT_VOICE_ICE_SERVERS } from '../contracts';
import { ENV, type Env } from '../core/env';
import { GameModule } from '../game/game.module';
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
  imports: [ProfilesModule, GameModule, TrucoModule, UnoModule],
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
      inject: [MembershipService, TrucoRoomsService, UnoRoomsService],
      useFactory: (
        bingo: MembershipService,
        truco: TrucoRoomsService,
        uno: UnoRoomsService,
      ): VoiceMembership => ({
        isMember: (game, code, userId) => {
          if (game === 'truco')
            return Promise.resolve(truco.roomOf(userId) === code);
          if (game === 'uno')
            return Promise.resolve(uno.roomOf(userId) === code);
          return bingo.isMember(code, userId);
        },
      }),
    },
    VoiceGateway,
  ],
})
export class VoiceModule {}
