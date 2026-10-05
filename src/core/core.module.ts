import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './env';
import { PrismaService } from './prisma.service';
import { RANDOM_INT, cryptoRandomInt } from './random';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: RANDOM_INT, useValue: cryptoRandomInt },
    PrismaService,
  ],
  exports: [ENV, RANDOM_INT, PrismaService],
})
export class CoreModule {}
