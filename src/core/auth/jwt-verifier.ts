import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { DomainError } from '../domain-error';
import { ENV, Env } from '../env';

export interface AuthUser {
  id: string;
  isAnonymous: boolean;
}

export const JWT_KEY_SET = Symbol('JWT_KEY_SET');

@Injectable()
export class JwtVerifier {
  private readonly issuer: string;

  constructor(
    @Inject(JWT_KEY_SET) private readonly keySet: JWTVerifyGetKey,
    @Inject(ENV) env: Pick<Env, 'SUPABASE_URL'>,
  ) {
    this.issuer = `${env.SUPABASE_URL}/auth/v1`;
  }

  async verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        issuer: this.issuer,
        audience: 'authenticated',
      });
      if (typeof payload.sub !== 'string') throw new Error('sub ausente');
      return { id: payload.sub, isAnonymous: payload.is_anonymous === true };
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Sessão inválida ou expirada');
    }
  }
}
