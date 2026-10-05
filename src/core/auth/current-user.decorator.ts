import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './http-auth.guard';
import type { AuthUser } from './jwt-verifier';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw new Error('CurrentUser usado sem HttpAuthGuard');
    return user;
  },
);
