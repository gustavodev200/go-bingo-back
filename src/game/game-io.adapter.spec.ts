import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import { GameIoAdapter } from './game-io.adapter';

describe('GameIoAdapter', () => {
  it('forces the configured CORS origin onto whatever options it receives', () => {
    const fakeServer = {} as Server;
    const superCreate = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue(fakeServer);

    const adapter = new GameIoAdapter({} as never, 'https://front.example');
    const result = adapter.createIOServer(3333, {
      path: '/socket.io',
    } as ServerOptions);

    expect(superCreate).toHaveBeenCalledWith(3333, {
      path: '/socket.io',
      cors: { origin: 'https://front.example' },
    });
    expect(result).toBe(fakeServer);
    superCreate.mockRestore();
  });

  it('still sets the CORS origin when called with no prior options', () => {
    const superCreate = jest
      .spyOn(IoAdapter.prototype, 'createIOServer')
      .mockReturnValue({} as Server);

    const adapter = new GameIoAdapter({} as never, 'https://other.example');
    adapter.createIOServer(4444);

    expect(superCreate).toHaveBeenCalledWith(4444, {
      cors: { origin: 'https://other.example' },
    });
    superCreate.mockRestore();
  });
});
