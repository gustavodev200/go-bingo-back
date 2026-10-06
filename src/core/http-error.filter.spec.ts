import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { DomainError } from './domain-error';
import { HttpErrorFilter, toHttpError } from './http-error.filter';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

function makeHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const getResponse = jest.fn(() => ({ status }));
  const host = {
    switchToHttp: () => ({ getResponse }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('toHttpError', () => {
  it('maps domain errors to their status', () => {
    expect(toHttpError(new DomainError('ROOM_FULL', 'Sala cheia'))).toEqual({
      status: 409,
      body: { code: 'ROOM_FULL', message: 'Sala cheia' },
    });
    expect(toHttpError(new DomainError('UNAUTHENTICATED', 'x')).status).toBe(
      401,
    );
    expect(toHttpError(new DomainError('NOT_HOST', 'x')).status).toBe(403);
  });

  it('maps throttling to 429', () => {
    expect(toHttpError(new ThrottlerException()).body.code).toBe(
      'RATE_LIMITED',
    );
  });

  it('maps unknown routes to NOT_FOUND', () => {
    expect(toHttpError(new NotFoundException()).body.code).toBe('NOT_FOUND');
  });

  it('maps a 401 HttpException to UNAUTHENTICATED', () => {
    expect(toHttpError(new UnauthorizedException('nope'))).toEqual({
      status: 401,
      body: { code: 'UNAUTHENTICATED', message: 'nope' },
    });
  });

  it('maps any other HttpException status to INVALID_PAYLOAD', () => {
    expect(toHttpError(new BadRequestException('bad body'))).toEqual({
      status: 400,
      body: { code: 'INVALID_PAYLOAD', message: 'bad body' },
    });
    expect(toHttpError(new HttpException('teapot', 418))).toEqual({
      status: 418,
      body: { code: 'INVALID_PAYLOAD', message: 'teapot' },
    });
  });

  it('hides internal errors', () => {
    expect(toHttpError(new Error('db password leaked'))).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Erro interno' },
    });
  });
});

describe('HttpErrorFilter', () => {
  it('writes the mapped status and body onto the response', () => {
    const filter = new HttpErrorFilter();
    const { host, status, json } = makeHost();

    filter.catch(new DomainError('ROOM_FULL', 'Sala cheia'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: 'ROOM_FULL',
      message: 'Sala cheia',
    });
  });

  it('logs unexpected errors that map to 500, but not domain errors', () => {
    const filter = new HttpErrorFilter();
    const logger = jest
      .spyOn(
        (filter as unknown as { logger: { error: (e: unknown) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);

    filter.catch(new DomainError('NOT_HOST', 'x'), makeHost().host);
    expect(logger).not.toHaveBeenCalled();

    const boom = new Error('db password leaked');
    filter.catch(boom, makeHost().host);
    expect(logger).toHaveBeenCalledWith(boom);
  });

  it('envia ao Sentry só erro 500, nunca erro de domínio nem 4xx', () => {
    const filter = new HttpErrorFilter();
    jest
      .spyOn(
        (filter as unknown as { logger: { error: (e: unknown) => void } })
          .logger,
        'error',
      )
      .mockImplementation(() => undefined);
    (Sentry.captureException as jest.Mock).mockClear();
    const { host } = makeHost();
    filter.catch(new DomainError('NOT_HOST', 'x'), host);
    filter.catch(new NotFoundException(), host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    const boom = new Error('boom');
    filter.catch(boom, host);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom);
  });
});
