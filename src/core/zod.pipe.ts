import { PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import { DomainError } from './domain-error';

export class ZodPipe<S extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<S>
> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new DomainError(
        'INVALID_PAYLOAD',
        parsed.error.issues[0]?.message ?? 'Dados inválidos',
      );
    }
    return parsed.data;
  }
}
