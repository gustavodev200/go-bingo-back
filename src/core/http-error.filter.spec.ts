import { NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DomainError } from './domain-error';
import { toHttpError } from './http-error.filter';

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

  it('hides internal errors', () => {
    expect(toHttpError(new Error('db password leaked'))).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Erro interno' },
    });
  });
});
