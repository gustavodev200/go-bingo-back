import { Injectable } from '@nestjs/common';
import {
  VOICE_MAX_PEERS,
  voiceChannel,
  type VoiceGame,
  type VoicePeer,
} from '../contracts';
import { DomainError } from '../core/domain-error';

export interface VoiceMember {
  channel: string;
  game: VoiceGame;
  code: string;
  peer: VoicePeer;
}

export interface VoiceJoinResult {
  channel: string;
  /** Everyone else already in the channel. */
  others: VoicePeer[];
  /** The same user's previous session in this channel, closed by this join. */
  replaced: VoiceMember | null;
  /** This socket's previous channel, left by this join. */
  left: VoiceMember | null;
}

/** Who is in which voice channel. One channel per socket, one socket per user and channel. */
@Injectable()
export class VoiceChannelsService {
  private readonly channels = new Map<string, Map<string, VoiceMember>>();
  private readonly bySocket = new Map<string, VoiceMember>();

  join(peer: VoicePeer, game: VoiceGame, code: string): VoiceJoinResult {
    const channel = voiceChannel(game, code);
    const current = this.bySocket.get(peer.peerId);
    if (current?.channel === channel) {
      current.peer.muted = peer.muted;
      return {
        channel,
        others: this.othersOf(current),
        replaced: null,
        left: null,
      };
    }

    const members = this.channels.get(channel);
    const previous = [...(members?.values() ?? [])].find(
      (m) => m.peer.userId === peer.userId,
    );
    if (!previous && (members?.size ?? 0) >= VOICE_MAX_PEERS)
      throw new DomainError('ROOM_FULL', 'O canal de voz está cheio');

    const left = current ? this.leave(peer.peerId) : null;
    const replaced = previous ? this.leave(previous.peer.peerId) : null;
    const member: VoiceMember = { channel, game, code, peer: { ...peer } };
    const target = this.channels.get(channel) ?? new Map<string, VoiceMember>();
    target.set(peer.peerId, member);
    this.channels.set(channel, target);
    this.bySocket.set(peer.peerId, member);
    return { channel, others: this.othersOf(member), replaced, left };
  }

  leave(peerId: string): VoiceMember | null {
    const member = this.bySocket.get(peerId);
    if (!member) return null;
    this.bySocket.delete(peerId);
    const members = this.channels.get(member.channel);
    members?.delete(peerId);
    if (members?.size === 0) this.channels.delete(member.channel);
    return member;
  }

  setMuted(peerId: string, muted: boolean): VoiceMember | null {
    const member = this.bySocket.get(peerId);
    if (member) member.peer.muted = muted;
    return member ?? null;
  }

  /** Signaling only flows between two peers of the same channel. */
  sameChannel(a: string, b: string): boolean {
    if (a === b) return false;
    const channel = this.bySocket.get(a)?.channel;
    return channel !== undefined && this.bySocket.get(b)?.channel === channel;
  }

  memberOf(peerId: string): VoiceMember | undefined {
    return this.bySocket.get(peerId);
  }

  members(): VoiceMember[] {
    return [...this.bySocket.values()];
  }

  private othersOf(member: VoiceMember): VoicePeer[] {
    return [...(this.channels.get(member.channel)?.values() ?? [])]
      .filter((m) => m.peer.peerId !== member.peer.peerId)
      .map((m) => ({ ...m.peer }));
  }
}
