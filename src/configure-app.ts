import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { ENV, Env } from './core/env';
import { HttpErrorFilter } from './core/http-error.filter';
import { GameIoAdapter } from './game/game-io.adapter';

export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN });
  app.useGlobalFilters(new HttpErrorFilter());
  app.useWebSocketAdapter(new GameIoAdapter(app, env.CORS_ORIGIN));
  app.enableShutdownHooks();
}
