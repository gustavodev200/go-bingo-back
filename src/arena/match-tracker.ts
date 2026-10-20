import { randomUUID } from 'node:crypto';
import type { MatchParticipant } from './arena.service';

export interface TrackedPlayer {
  seat: number;
  userId: string;
}

/**
 * Acompanha uma partida dos jogos em memória: quem sentou quando ela começou, quem saiu no meio
 * e quando acabou. As salas só montam o placar final; o resto é igual para todos os jogos.
 */
export class MatchTracker {
  readonly matchId = randomUUID();
  private readonly left = new Set<number>();

  /**
   * `players` são só os humanos. `cpuPlayers` > 0 = teve CPU na mesa: a Arena liquida como
   * partida contra a CPU (sem ranking nem aposta, só o agrado fixo).
   */
  constructor(
    private readonly players: readonly TrackedPlayer[],
    private readonly startedAt: number,
    readonly cpuPlayers = 0,
  ) {}

  /** Saiu no meio da partida: perde, paga multa e não recebe nada. */
  markLeft(seat: number): void {
    this.left.add(seat);
  }

  /** Todos os lugares da partida, inclusive de quem já saiu. */
  seatList(): number[] {
    return this.players.map((p) => p.seat);
  }

  durationMs(now: number): number {
    return Math.max(0, now - this.startedAt);
  }

  participants(placementOf: (seat: number) => number): MatchParticipant[] {
    return this.players.map((p) => ({
      userId: p.userId,
      placement: placementOf(p.seat),
      abandoned: this.left.has(p.seat),
    }));
  }
}

/**
 * Colocação por pontos (1 = melhor, empates dividem o lugar). Quem está em `winners` é sempre 1;
 * os demais ficam a partir do 2.
 */
export function rankSeats(
  seats: readonly number[],
  scoreOf: (seat: number) => number,
  winners: ReadonlySet<number>,
): (seat: number) => number {
  const others = seats.filter((s) => !winners.has(s));
  return (seat) => {
    if (winners.has(seat)) return 1;
    const ahead = others.filter((o) => scoreOf(o) > scoreOf(seat)).length;
    return 2 + ahead;
  };
}
