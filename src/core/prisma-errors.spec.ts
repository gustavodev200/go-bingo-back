import { Prisma } from '../generated/prisma/client';
import { isUniqueViolation } from './prisma-errors';

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: '0.0.0',
  });
}

describe('isUniqueViolation', () => {
  it('returns false for a plain Error', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });

  it('returns false for a non-error value', () => {
    expect(isUniqueViolation('not an error')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('returns true for a P2002 unique constraint violation', () => {
    expect(isUniqueViolation(knownRequestError('P2002'))).toBe(true);
  });

  it('returns false for a known Prisma error with a different code', () => {
    expect(isUniqueViolation(knownRequestError('P2025'))).toBe(false);
  });
});
