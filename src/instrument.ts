// coverage: justificativa — inicialização do SDK (sem lógica de decisão própria),
// precisa rodar antes de qualquer outro import; exercitado no boot real.
/* istanbul ignore file */
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN, // undefined = SDK desligado
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  // @sentry/nestjs v11 trocou `sendDefaultPii` por `dataCollection` (os
  // defaults coletam tudo); aqui desligamos tudo que pode carregar PII/tokens.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    stackFrameVariables: false,
  },
  tracesSampleRate: 0.1,
});
