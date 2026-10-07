import { DomainError } from '../core/domain-error';
import type { Prisma } from '../generated/prisma/client';
import { charge, chargeUpTo, credit, saoPauloDay } from './ledger';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function makeTx() {
  const tx = {
    profile: { update: jest.fn(), updateMany: jest.fn() },
    coinTransaction: { create: jest.fn(), createMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

describe('credit', () => {
  it('adds coins and writes a positive ledger line', async () => {
    const { tx, client } = makeTx();
    await credit(client, A, 100, 'WIN', 'g1');
    expect(tx.profile.update).toHaveBeenCalledWith({
      where: { id: A },
      data: { coins: { increment: 100 } },
    });
    expect(tx.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: A, amount: 100, reason: 'WIN', gameId: 'g1' },
    });
  });
});

describe('charge', () => {
  it('only charges when the balance covers the full amount', async () => {
    const { tx, client } = makeTx();
    tx.profile.updateMany.mockResolvedValue({ count: 1 });
    await charge(client, A, 5, 'CARD');
    expect(tx.profile.updateMany).toHaveBeenCalledWith({
      where: { id: A, coins: { gte: 5 } },
      data: { coins: { decrement: 5 } },
    });
    expect(tx.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: A, amount: -5, reason: 'CARD', gameId: undefined },
    });
  });

  it('fails with INSUFFICIENT_COINS and writes nothing when the balance is short', async () => {
    const { tx, client } = makeTx();
    tx.profile.updateMany.mockResolvedValue({ count: 0 });
    const error = await charge(client, A, 5, 'CARD').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('INSUFFICIENT_COINS');
    expect(tx.coinTransaction.create).not.toHaveBeenCalled();
  });
});

describe('chargeUpTo', () => {
  it('records only what was actually taken (stops at zero)', async () => {
    const { tx, client } = makeTx();
    tx.$queryRaw.mockResolvedValue([
      { id: A, charged: 20 },
      { id: B, charged: 0 },
    ]);
    await chargeUpTo(client, [A, B], 20, 'LOSS', 'g1');
    expect(tx.coinTransaction.createMany).toHaveBeenCalledWith({
      data: [{ userId: A, amount: -20, reason: 'LOSS', gameId: 'g1' }],
    });
  });

  it('does nothing for an empty list', async () => {
    const { tx, client } = makeTx();
    await chargeUpTo(client, [], 20, 'LOSS');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips the ledger when nobody had coins', async () => {
    const { tx, client } = makeTx();
    tx.$queryRaw.mockResolvedValue([{ id: A, charged: 0 }]);
    await chargeUpTo(client, [A], 20, 'LOSS');
    expect(tx.coinTransaction.createMany).not.toHaveBeenCalled();
  });
});

describe('saoPauloDay', () => {
  it('uses the Brazilian calendar day', () => {
    // 01:30 UTC de 08/10 ainda é 22:30 de 07/10 em São Paulo.
    expect(saoPauloDay(new Date('2026-10-08T01:30:00Z')).toISOString()).toBe(
      '2026-10-07T00:00:00.000Z',
    );
    expect(saoPauloDay(new Date('2026-10-08T15:00:00Z')).toISOString()).toBe(
      '2026-10-08T00:00:00.000Z',
    );
  });
});
