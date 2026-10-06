import { ConsoleLogger } from '@nestjs/common';
import { buildLogger } from './logging';

describe('buildLogger', () => {
  it('produção usa JSON; dev/test usam o formato padrão', () => {
    expect(buildLogger('production')).toBeInstanceOf(ConsoleLogger);
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    buildLogger('production').log({ event: 'x', roomCode: 'ABC123' });
    const line = String(write.mock.calls[0][0]);
    write.mockRestore();
    expect(JSON.parse(line)).toMatchObject({
      level: 'log',
      message: { event: 'x', roomCode: 'ABC123' },
    });
  });
});
