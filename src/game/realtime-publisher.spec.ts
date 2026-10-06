import {
  PUBLIC_ROOMS_CHANNEL,
  roomChannel,
  ServerEvents,
  userChannel,
} from '../contracts';
import type { RoomsService } from '../rooms/rooms.service';
import { RealtimePublisher } from './realtime-publisher';

function makeServer() {
  const emit = jest.fn();
  const socketsLeave = jest.fn();
  const to = jest.fn(() => ({ emit, socketsLeave }));
  const inFn = jest.fn(() => ({ socketsLeave }));
  return { to, in: inFn, emit, socketsLeave };
}

describe('RealtimePublisher', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('no-ops every emit helper before a server is attached', () => {
    const publisher = new RealtimePublisher({} as unknown as RoomsService);
    expect(() => {
      publisher.toRoom('ABC123', ServerEvents.GAME_STARTED, {
        gameId: 'g1',
        drawIntervalMs: 1,
      });
      publisher.toUser('u1', ServerEvents.GAME_STARTED, {
        gameId: 'g1',
        drawIntervalMs: 1,
      });
      publisher.removeUserFromRoom('u1', 'ABC123');
      publisher.closeRoomChannel('ABC123');
    }).not.toThrow();
  });

  it('toRoom() emits on the room channel', () => {
    const publisher = new RealtimePublisher({} as unknown as RoomsService);
    const server = makeServer();
    publisher.attach(server as never);

    publisher.toRoom('ABC123', ServerEvents.GAME_ENDED, {
      reason: 'exhausted',
    });

    expect(server.to).toHaveBeenCalledWith(roomChannel('ABC123'));
    expect(server.emit).toHaveBeenCalledWith(ServerEvents.GAME_ENDED, {
      reason: 'exhausted',
    });
  });

  it('toUser() emits on the user channel', () => {
    const publisher = new RealtimePublisher({} as unknown as RoomsService);
    const server = makeServer();
    publisher.attach(server as never);

    publisher.toUser('u1', ServerEvents.MEMBER_READY, { userId: 'u1' });

    expect(server.to).toHaveBeenCalledWith(userChannel('u1'));
    expect(server.emit).toHaveBeenCalledWith(ServerEvents.MEMBER_READY, {
      userId: 'u1',
    });
  });

  it('removeUserFromRoom() drops the user socket out of the room channel', () => {
    const publisher = new RealtimePublisher({} as unknown as RoomsService);
    const server = makeServer();
    publisher.attach(server as never);

    publisher.removeUserFromRoom('u1', 'ABC123');

    expect(server.in).toHaveBeenCalledWith(userChannel('u1'));
    expect(server.socketsLeave).toHaveBeenCalledWith(roomChannel('ABC123'));
  });

  it('closeRoomChannel() empties the room channel', () => {
    const publisher = new RealtimePublisher({} as unknown as RoomsService);
    const server = makeServer();
    publisher.attach(server as never);

    publisher.closeRoomChannel('ABC123');

    expect(server.in).toHaveBeenCalledWith(roomChannel('ABC123'));
    expect(server.socketsLeave).toHaveBeenCalledWith(roomChannel('ABC123'));
  });

  it('publicRoomsChanged() debounces bursts into a single broadcast', async () => {
    const listPublic = jest.fn().mockResolvedValue([{ code: 'ABC123' }]);
    const publisher = new RealtimePublisher({
      listPublic,
    } as unknown as RoomsService);
    const server = makeServer();
    publisher.attach(server as never);

    publisher.publicRoomsChanged();
    publisher.publicRoomsChanged();
    publisher.publicRoomsChanged();
    expect(listPublic).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();

    expect(listPublic).toHaveBeenCalledTimes(1);
    expect(server.to).toHaveBeenCalledWith(PUBLIC_ROOMS_CHANNEL);
    expect(server.emit).toHaveBeenCalledWith(ServerEvents.ROOMS_UPDATED, {
      rooms: [{ code: 'ABC123' }],
    });
  });

  it('publicRoomsChanged() logs instead of throwing when listPublic() rejects', async () => {
    const boom = new Error('db down');
    const listPublic = jest.fn().mockRejectedValue(boom);
    const publisher = new RealtimePublisher({
      listPublic,
    } as unknown as RoomsService);
    const logger = jest
      .spyOn(
        (publisher as unknown as { logger: { error: (e: unknown) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);
    publisher.attach(makeServer() as never);

    publisher.publicRoomsChanged();
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(logger).toHaveBeenCalledWith(boom);
  });

  it('onModuleDestroy() cancels a pending debounce before it fires', async () => {
    const listPublic = jest.fn().mockResolvedValue([]);
    const publisher = new RealtimePublisher({
      listPublic,
    } as unknown as RoomsService);
    publisher.attach(makeServer() as never);

    publisher.publicRoomsChanged();
    publisher.onModuleDestroy();
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();

    expect(listPublic).not.toHaveBeenCalled();
  });
});
