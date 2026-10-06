import type { AuthUser } from '../core/auth/jwt-verifier';
import { RoomsController } from './rooms.controller';
import type { RoomsService } from './rooms.service';

const user: AuthUser = { id: 'u1', isAnonymous: false };

describe('RoomsController', () => {
  it('create() delegates to the service with the host id', () => {
    const rooms = { create: jest.fn().mockResolvedValue({ code: 'ABC123' }) };
    const controller = new RoomsController(rooms as unknown as RoomsService);
    const input = { name: 'Amigos', maxPlayers: 10 as const, isPublic: true };

    const result = controller.create(user, input);

    expect(rooms.create).toHaveBeenCalledWith('u1', input);
    return expect(result).resolves.toEqual({ code: 'ABC123' });
  });

  it('list() delegates to listPublic()', () => {
    const rooms = { listPublic: jest.fn().mockResolvedValue([]) };
    const controller = new RoomsController(rooms as unknown as RoomsService);

    const result = expect(controller.list()).resolves.toEqual([]);
    expect(rooms.listPublic).toHaveBeenCalledTimes(1);
    return result;
  });

  it('summary() rejects a code that fails the format before touching the service', () => {
    const rooms = { summary: jest.fn() };
    const controller = new RoomsController(rooms as unknown as RoomsService);

    expect(() => controller.summary('???')).toThrow(/Sala não encontrada/);
    expect(rooms.summary).not.toHaveBeenCalled();
  });

  it('summary() normalizes and forwards a valid code to the service', () => {
    const rooms = {
      summary: jest.fn().mockResolvedValue({ code: 'AB3K9Z' }),
    };
    const controller = new RoomsController(rooms as unknown as RoomsService);

    const result = controller.summary('ab3k9z');

    expect(rooms.summary).toHaveBeenCalledWith('AB3K9Z');
    return expect(result).resolves.toEqual({ code: 'AB3K9Z' });
  });
});
