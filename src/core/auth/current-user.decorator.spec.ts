import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import type { AuthedRequest } from './http-auth.guard';
import type { AuthUser } from './jwt-verifier';

/** Extrai a factory crua por trás do @CurrentUser(), sem precisar de um
 * request HTTP real nem da maquinaria de injeção do Nest — receita padrão
 * para testar `createParamDecorator`. */
type ParamFactory = (data: unknown, ctx: ExecutionContext) => AuthUser;

function getCurrentUserFactory(): ParamFactory {
  class TestController {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- param only exists so @CurrentUser() has somewhere to attach
    method(@CurrentUser() user: AuthUser) {}
  }
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestController,
    'method',
  ) as Record<string, { factory: ParamFactory }>;
  const key = Object.keys(args)[0];
  return args[key].factory;
}

function makeContext(user?: AuthUser): ExecutionContext {
  const req = { user } as AuthedRequest;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser', () => {
  it('throws when used without HttpAuthGuard (req.user unset)', () => {
    const factory = getCurrentUserFactory();
    expect(() => factory(undefined, makeContext(undefined))).toThrow(
      /HttpAuthGuard/,
    );
  });

  it('returns the authenticated user when req.user is set', () => {
    const factory = getCurrentUserFactory();
    const user: AuthUser = { id: 'abc-123', isAnonymous: false };

    expect(factory(undefined, makeContext(user))).toEqual(user);
  });
});
