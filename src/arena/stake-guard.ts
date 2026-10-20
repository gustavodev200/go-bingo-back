import { stakeLevel, TIERS, tierIndexFor, type ArenaGame } from '../contracts';
import { DomainError } from '../core/domain-error';

/**
 * Quem pode sentar numa mesa com esta aposta: o valor existe no jogo, o jogador tem a liga
 * exigida e saldo para cobrir a entrada (+ `extra`, ex.: a cartela do bingo). Lança o erro do
 * primeiro problema; `who` entra na mensagem ("Você", ou o apelido quando o anfitrião inicia).
 */
export function checkStake(
  game: ArenaGame,
  stake: number,
  player: { coins: number; points: number },
  who = 'Você',
  extra = 0,
): void {
  const level = stakeLevel(game, stake);
  if (!level)
    throw new DomainError('INVALID_PAYLOAD', 'Aposta inválida para este jogo');
  if (tierIndexFor(player.points) < level.minTier)
    throw new DomainError(
      'STAKE_LOCKED',
      `${who} precisa da liga ${TIERS[level.minTier].label} para a mesa ${level.label}`,
    );
  if (player.coins < stake + extra)
    throw new DomainError(
      'INSUFFICIENT_COINS',
      `${who} precisa de ${stake + extra} moedas para esta mesa`,
    );
}
