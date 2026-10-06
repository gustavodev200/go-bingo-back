import type { INestApplication } from '@nestjs/common';
import { configureApp } from './configure-app';
import { ENV, type Env } from './core/env';
import { HttpErrorFilter } from './core/http-error.filter';
import { GameIoAdapter } from './game/game-io.adapter';

describe('configureApp', () => {
  it('wires security headers, CORS, the error filter, the ws adapter and shutdown hooks', () => {
    const env: Pick<Env, 'CORS_ORIGIN'> = {
      CORS_ORIGIN: 'https://front.example',
    };
    const use = jest.fn<void, [unknown]>();
    const enableCors = jest.fn();
    const useGlobalFilters = jest.fn();
    const useWebSocketAdapter = jest.fn();
    const enableShutdownHooks = jest.fn();
    const get = jest.fn((token: unknown) => {
      if (token === ENV) return env;
      throw new Error(`unexpected token ${String(token)}`);
    });
    const app = {
      use,
      enableCors,
      useGlobalFilters,
      useWebSocketAdapter,
      enableShutdownHooks,
      get,
    } as unknown as INestApplication;

    configureApp(app);

    expect(get).toHaveBeenCalledWith(ENV);
    expect(use).toHaveBeenCalledTimes(1);
    expect(typeof use.mock.calls[0][0]).toBe('function');
    expect(enableCors).toHaveBeenCalledWith({
      origin: 'https://front.example',
    });
    expect(useGlobalFilters).toHaveBeenCalledWith(expect.any(HttpErrorFilter));
    expect(useWebSocketAdapter).toHaveBeenCalledWith(expect.any(GameIoAdapter));
    expect(enableShutdownHooks).toHaveBeenCalledTimes(1);
  });
});
