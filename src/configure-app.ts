import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { ENV, Env } from './core/env';

export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN });
  app.enableShutdownHooks();
}
