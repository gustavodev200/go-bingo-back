import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DomainError } from '../domain-error';
import { AuthUser, JwtVerifier } from './jwt-verifier';

export type AuthedRequest = Request & { user?: AuthUser };

@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly verifier: JwtVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new DomainError('UNAUTHENTICATED', 'Token ausente');
    req.user = await this.verifier.verify(header.slice('Bearer '.length));
    return true;
  }
}
