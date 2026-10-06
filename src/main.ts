// coverage: justificativa — bootstrap de processo (sequência fixa de
// chamadas ao NestFactory, sem branch/decisão); exercitado de fato pelos
// testes e2e, que sobem a aplicação real.
/* istanbul ignore file */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';
import { ENV, Env } from './core/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(app.get<Env>(ENV).PORT);
}
void bootstrap();
