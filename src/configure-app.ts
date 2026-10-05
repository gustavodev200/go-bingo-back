import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { ENV, Env } from './core/env';
import { HttpErrorFilter } from './core/http-error.filter';

export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN });
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
}
