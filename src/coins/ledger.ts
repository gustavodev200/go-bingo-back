import type { CoinReason } from '../contracts';
import { DomainError } from '../core/domain-error';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Movimentações de moedas. Sempre dentro da transação de quem chama, para o saldo e o
 * extrato (CoinTransaction) andarem juntos com a regra de jogo que os causou.
 */

export async function credit(
  tx: Tx,
  userId: string,
  amount: number,
  reason: CoinReason,
  gameId?: string,
): Promise<void> {
  await tx.profile.update({
    where: { id: userId },
    data: { coins: { increment: amount } },
  });
  await tx.coinTransaction.create({
    data: { userId, amount, reason, gameId },
  });
}

/** Cobra o valor cheio; sem saldo, falha com INSUFFICIENT_COINS (nada é cobrado). */
export async function charge(
  tx: Tx,
  userId: string,
  amount: number,
  reason: CoinReason,
  gameId?: string,
): Promise<void> {
  // Condicional no próprio UPDATE: duas cobranças simultâneas não passam do saldo.
  const charged = await tx.profile.updateMany({
    where: { id: userId, coins: { gte: amount } },
    data: { coins: { decrement: amount } },
  });
  if (charged.count !== 1)
    throw new DomainError(
      'INSUFFICIENT_COINS',
      `Você precisa de ${amount} moedas`,
    );
  await tx.coinTransaction.create({
    data: { userId, amount: -amount, reason, gameId },
  });
}

/**
 * Cobra até `amount` de cada jogador, parando em zero (saldo nunca negativo).
 * O extrato registra o valor efetivamente descontado; quem já estava zerado não gera linha.
 */
export async function chargeUpTo(
  tx: Tx,
  userIds: readonly string[],
  amount: number,
  reason: CoinReason,
  gameId?: string,
): Promise<void> {
  if (userIds.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string; charged: number }>>`
    WITH before AS (
      SELECT "id", "coins" FROM "Profile" WHERE "id" = ANY(${[...userIds]}::uuid[]) FOR UPDATE
    )
    UPDATE "Profile" p SET "coins" = GREATEST(p."coins" - ${amount}, 0)
    FROM before WHERE p."id" = before."id"
    RETURNING p."id", (before."coins" - p."coins")::int AS "charged"`;
  const data = rows
    .filter((r) => r.charged > 0)
    .map((r) => ({ userId: r.id, amount: -r.charged, reason, gameId }));
  if (data.length > 0) await tx.coinTransaction.createMany({ data });
}

/** Dia corrente no fuso do Brasil, como DATE (meia-noite UTC) — chave do bônus diário. */
export function saoPauloDay(now: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(now);
  return new Date(`${ymd}T00:00:00.000Z`);
}
