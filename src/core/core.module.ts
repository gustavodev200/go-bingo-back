// coverage: justificativa — declaração de módulo NestJS (wiring de DI puro,
// sem branch/lógica de decisão); os providers aqui registrados (env, random,
// JWKS, PrismaService, JwtVerifier, HttpAuthGuard) já têm testes próprios.
/* istanbul ignore file */
import { Global, Module } from '@nestjs/common';
import { createRemoteJWKSet } from 'jose';
import { HttpAuthGuard } from './auth/http-auth.guard';
import { JWT_KEY_SET, JwtVerifier } from './auth/jwt-verifier';
import { ENV, Env, loadEnv } from './env';
import { PrismaService } from './prisma.service';
import { RANDOM_INT, cryptoRandomInt } from './random';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: RANDOM_INT, useValue: cryptoRandomInt },
    {
      provide: JWT_KEY_SET,
      inject: [ENV],
      useFactory: (env: Env) =>
        createRemoteJWKSet(
          new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
        ),
    },
    PrismaService,
    JwtVerifier,
    HttpAuthGuard,
  ],
  exports: [ENV, RANDOM_INT, PrismaService, JwtVerifier, HttpAuthGuard],
})
export class CoreModule {}
