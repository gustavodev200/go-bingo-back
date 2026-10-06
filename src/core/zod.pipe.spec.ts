import { z } from 'zod';
import { DomainError } from './domain-error';
import { ZodPipe } from './zod.pipe';

describe('ZodPipe', () => {
  const schema = z.object({ name: z.string().min(3) });

  it('returns the parsed value when it matches the schema', () => {
    const pipe = new ZodPipe(schema);
    expect(pipe.transform({ name: 'abc' })).toEqual({ name: 'abc' });
  });

  it('throws a DomainError with the first Zod issue message when invalid', () => {
    const pipe = new ZodPipe(schema);
    expect(() => pipe.transform({ name: 'a' })).toThrow(DomainError);
    try {
      pipe.transform({ name: 'a' });
      throw new Error('expected transform to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('INVALID_PAYLOAD');
      expect((error as DomainError).message.length).toBeGreaterThan(0);
    }
  });

  it('falls back to a generic message when there is no issue message', () => {
    const fakeSchema = {
      safeParse: () => ({ success: false, error: { issues: [] } }),
    };
    const fallbackPipe = new ZodPipe(fakeSchema as unknown as typeof schema);
    expect(() => fallbackPipe.transform({})).toThrow('Dados inválidos');
  });
});
