import { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
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
  // Atrás de um reverse proxy/load balancer, sem isso o Express vê o IP do
  // proxy em toda requisição — o throttle global de HTTP (ThrottlerModule)
  // enxergaria um balde só compartilhado por todos os clientes em vez de um
  // por IP real. Só liga quando TRUST_PROXY=true (ver .env.example).
  if (env.TRUST_PROXY) {
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', true);
  }
  app.enableShutdownHooks();
}
