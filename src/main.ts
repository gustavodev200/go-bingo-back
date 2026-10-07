// coverage: justificativa — bootstrap de processo (sequência fixa de
// chamadas ao NestFactory, sem branch/decisão); exercitado de fato pelos
// testes e2e, que sobem a aplicação real.
/* istanbul ignore file */
import './instrument';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { ENV, Env } from './core/env';
import { buildLogger } from './core/logging';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: buildLogger(process.env.NODE_ENV ?? 'development'),
  });
  configureApp(app);
  await app.listen(app.get<Env>(ENV).PORT);
}
void bootstrap();
