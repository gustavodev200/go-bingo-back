import { RECONNECT_GRACE_MS } from '../contracts';
import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tracks multiple sockets per user', () => {
    const p = new PresenceService();
    expect(p.connect('ROOM01', 'u1', 's1')).toEqual({
      firstSocket: true,
      reconnected: false,
    });
    expect(p.connect('ROOM01', 'u1', 's2')).toEqual({
      firstSocket: false,
      reconnected: false,
    });
    expect(p.disconnect('ROOM01', 'u1', 's1')).toEqual({ offline: false });
    expect(p.connectedSet('ROOM01')).toEqual(new Set(['u1']));
  });

  it('expires a user after the grace window', () => {
    const p = new PresenceService();
    const expired = jest.fn();
    p.setExpiryHandler(expired);
    p.connect('ROOM01', 'u1', 's1');

    expect(p.disconnect('ROOM01', 'u1', 's1')).toEqual({ offline: true });
    expect(p.connectedSet('ROOM01').has('u1')).toBe(false);
    jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1);
    expect(expired).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledWith('ROOM01', 'u1');
  });

  it('cancels expiry on reconnect within the window', () => {
    const p = new PresenceService();
    const expired = jest.fn();
    p.setExpiryHandler(expired);
    p.connect('ROOM01', 'u1', 's1');
    p.disconnect('ROOM01', 'u1', 's1');

    jest.advanceTimersByTime(30_000);
    expect(p.connect('ROOM01', 'u1', 's9')).toEqual({
      firstSocket: true,
      reconnected: true,
    });
    jest.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(expired).not.toHaveBeenCalled();
  });

  it('remove and clearRoom drop pending timers', () => {
    const p = new PresenceService();
    const expired = jest.fn();
    p.setExpiryHandler(expired);
    p.connect('ROOM01', 'u1', 's1');
    p.connect('ROOM01', 'u2', 's2');
    p.disconnect('ROOM01', 'u1', 's1');
    p.remove('ROOM01', 'u1');
    p.disconnect('ROOM01', 'u2', 's2');
    p.clearRoom('ROOM01');
    jest.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(expired).not.toHaveBeenCalled();
  });

  it('disconnect() on an unknown room/user is a safe no-op', () => {
    const p = new PresenceService();
    expect(p.disconnect('UNKNOWN', 'ghost', 's1')).toEqual({ offline: false });
  });

  it('remove() on an unknown room/user is a safe no-op', () => {
    const p = new PresenceService();
    expect(() => p.remove('UNKNOWN', 'ghost')).not.toThrow();
  });

  it('clearRoom() on an unknown room is a safe no-op', () => {
    const p = new PresenceService();
    expect(() => p.clearRoom('UNKNOWN')).not.toThrow();
  });

  it('onModuleDestroy clears every pending expiry timer across all rooms', () => {
    const p = new PresenceService();
    const expired = jest.fn();
    p.setExpiryHandler(expired);
    p.connect('ROOM01', 'u1', 's1');
    p.connect('ROOM02', 'u2', 's2');
    p.disconnect('ROOM01', 'u1', 's1');
    p.disconnect('ROOM02', 'u2', 's2');

    p.onModuleDestroy();

    jest.advanceTimersByTime(RECONNECT_GRACE_MS);
    expect(expired).not.toHaveBeenCalled();
    expect(p.connectedSet('ROOM01').size).toBe(0);
    expect(p.connectedSet('ROOM02').size).toBe(0);
  });
});
