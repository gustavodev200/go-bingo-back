import { VOICE_MAX_PEERS } from '../contracts';
import { VoiceChannelsService } from './voice-channels.service';

const peer = (peerId: string, userId = peerId, muted = false) => ({
  peerId,
  userId,
  nickname: `nick-${userId}`,
  muted,
});

describe('VoiceChannelsService', () => {
  let channels: VoiceChannelsService;
  beforeEach(() => {
    channels = new VoiceChannelsService();
  });

  it('lists everyone already in the channel to the newcomer', () => {
    expect(channels.join(peer('s1'), 'uno', 'ABCDEF').others).toEqual([]);
    const res = channels.join(peer('s2'), 'uno', 'ABCDEF');
    expect(res.channel).toBe('voice:uno:ABCDEF');
    expect(res.others).toEqual([peer('s1')]);
    expect(res.replaced).toBeNull();
    expect(res.left).toBeNull();
  });

  it('keeps games and room codes apart', () => {
    channels.join(peer('s1'), 'uno', 'ABCDEF');
    expect(channels.join(peer('s2'), 'truco', 'ABCDEF').others).toEqual([]);
    expect(channels.join(peer('s3'), 'uno', 'ZZZZZZ').others).toEqual([]);
  });

  it('rejects a full channel', () => {
    for (let i = 0; i < VOICE_MAX_PEERS; i++)
      channels.join(peer(`s${i}`), 'bingo', 'ABCDEF');
    expect(() => channels.join(peer('late'), 'bingo', 'ABCDEF')).toThrow(
      'O canal de voz está cheio',
    );
  });

  it('replaces the same user’s older session, even in a full channel', () => {
    for (let i = 0; i < VOICE_MAX_PEERS; i++)
      channels.join(peer(`s${i}`), 'bingo', 'ABCDEF');
    const res = channels.join(peer('new-tab', 's0'), 'bingo', 'ABCDEF');
    expect(res.replaced?.peer.peerId).toBe('s0');
    expect(res.others).toHaveLength(VOICE_MAX_PEERS - 1);
    expect(channels.memberOf('s0')).toBeUndefined();
  });

  it('moves a socket that joins another channel', () => {
    channels.join(peer('s1'), 'uno', 'ABCDEF');
    channels.join(peer('s2'), 'uno', 'ABCDEF');
    const res = channels.join(peer('s1'), 'uno', 'ZZZZZZ');
    expect(res.left?.channel).toBe('voice:uno:ABCDEF');
    expect(channels.join(peer('s3'), 'uno', 'ABCDEF').others).toEqual([
      peer('s2'),
    ]);
  });

  it('treats joining the same channel again as a refresh', () => {
    channels.join(peer('s1'), 'uno', 'ABCDEF');
    channels.join(peer('s2'), 'uno', 'ABCDEF');
    const res = channels.join(peer('s1', 's1', true), 'uno', 'ABCDEF');
    expect(res.others).toEqual([peer('s2')]);
    expect(res.left).toBeNull();
    expect(channels.memberOf('s1')?.peer.muted).toBe(true);
  });

  it('leaves, forgetting empty channels', () => {
    channels.join(peer('s1'), 'uno', 'ABCDEF');
    expect(channels.leave('s1')?.code).toBe('ABCDEF');
    expect(channels.leave('s1')).toBeNull();
    expect(channels.members()).toEqual([]);
  });

  it('updates the mute flag', () => {
    expect(channels.setMuted('nobody', true)).toBeNull();
    channels.join(peer('s1'), 'uno', 'ABCDEF');
    expect(channels.setMuted('s1', true)?.peer.muted).toBe(true);
  });

  it('only allows signaling inside one channel', () => {
    channels.join(peer('s1'), 'uno', 'ABCDEF');
    channels.join(peer('s2'), 'uno', 'ABCDEF');
    channels.join(peer('s3'), 'uno', 'ZZZZZZ');
    expect(channels.sameChannel('s1', 's2')).toBe(true);
    expect(channels.sameChannel('s1', 's3')).toBe(false);
    expect(channels.sameChannel('s1', 's1')).toBe(false);
    expect(channels.sameChannel('ghost', 's1')).toBe(false);
  });
});
