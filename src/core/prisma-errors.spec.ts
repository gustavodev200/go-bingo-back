import { isUniqueViolation } from './prisma-errors';

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
});
