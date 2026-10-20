import {
  canPlaceCue,
  freeSpot,
  rackBalls,
  rackOrder,
  simulateShot,
  tacadaGroupOf,
  tacadaRemaining,
  TACADA_FOOT_SPOT,
  TACADA_HEAD_SPOT,
  TACADA_MAX_FOULS,
  TACADA_SIM_HZ,
  type TacadaBallPos,
  type TacadaEndReason,
  type TacadaFoul,
  type TacadaGameView,
  type TacadaGroup,
  type TacadaLastShot,
  type TacadaMatchResult,
  type TacadaServerEventPayloads,
  type TacadaShotOutcome,
  type TacadaShotRecord,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';

type AnnouncedEvent = {
  [E in keyof TacadaServerEventPayloads]: TacadaServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof TacadaServerEventPayloads];

/** Something that happened in the match; the room adds the sequence number and broadcasts it. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<TacadaServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

export type TacadaMatchPhase = 'PLAYING' | 'OVER';

export interface TacadaShotInput {
  dirX: number;
  dirY: number;
  power: number;
  spinX: number;
  spinY: number;
  cueX?: number;
  cueY?: number;
  pocket?: number;
}

const invalid = (message: string) => new DomainError('INVALID_MOVE', message);

const other = (group: TacadaGroup): TacadaGroup =>
  group === 'solids' ? 'stripes' : 'solids';

/**
 * One 8-ball game between two seats. Pure game logic: no transport, no clock.
 * The physics runs here (deterministic, shared with the client), then the
 * rules decide fouls, groups, turn and the end. `turnToken` changes whenever
 * the shot clock must restart.
 *
 * House rules (what makes Tacada different from plain 8-ball):
 * - the 8 must be called: it has to drop in the chosen pocket;
 * - the 8 pocketed on the break goes back to the foot spot (no instant win/loss);
 * - {TACADA_MAX_FOULS} fouls in a row lose the match (running out of time is a foul);
 * - after any foul the opponent gets the ball in hand anywhere on the table.
 */
export class TacadaMatch {
  private balls: TacadaBallPos[];
  private turnIndex = 0;
  private readonly groups: (TacadaGroup | null)[] = [null, null];
  private inHand = true;
  private isBreak = true;
  private readonly foulsInARow = [0, 0];
  private last: TacadaLastShot | null = null;
  private shotCount = 0;
  private matchPhase: TacadaMatchPhase = 'PLAYING';
  private outcome: TacadaMatchResult | null = null;
  private token = 0;
  /** Duração da animação da última tacada, em ms. */
  private lastDurationMs = 0;

  /**
   * @param seats the two seats at the table, as [breaker, other].
   * @param balls starting position (tests); a fresh rack by default.
   */
  constructor(
    random: RandomInt,
    private readonly seats: readonly [number, number],
    balls?: TacadaBallPos[],
    opts: { breakShot?: boolean; groups?: (TacadaGroup | null)[] } = {},
  ) {
    this.balls = balls
      ? balls.map((b) => (b ? ([b[0], b[1]] as const) : null))
      : rackBalls(rackOrder(random));
    if (opts.breakShot === false) {
      this.isBreak = false;
      this.inHand = this.balls[0] === null;
    }
    if (opts.groups) {
      this.groups[0] = opts.groups[0];
      this.groups[1] = opts.groups[1];
    }
  }

  get phase(): TacadaMatchPhase {
    return this.matchPhase;
  }

  get result(): TacadaMatchResult | null {
    return this.outcome;
  }

  get turnToken(): number {
    return this.token;
  }

  get turnSeat(): number {
    return this.seats[this.turnIndex];
  }

  /** Quanto dura a animação da última tacada (o relógio só corre depois dela). */
  get animationMs(): number {
    return this.lastDurationMs;
  }

  publicView(): Omit<TacadaGameView, 'turnDeadline' | 'readyAt'> {
    const groups: (TacadaGroup | null)[] = [null, null];
    const fouls = [0, 0];
    this.seats.forEach((seat, i) => {
      groups[seat] = this.groups[i];
      fouls[seat] = this.foulsInARow[i];
    });
    return {
      balls: this.balls.map((b) => (b ? ([b[0], b[1]] as const) : null)),
      turn: this.turnSeat,
      groups,
      ballInHand: this.inHand,
      breakShot: this.isBreak,
      onEight: this.onEight(this.turnIndex),
      fouls,
      lastShot: this.last
        ? { ...this.last, pocketed: [...this.last.pocketed] }
        : null,
      shots: this.shotCount,
    };
  }

  shoot(seat: number, input: TacadaShotInput): Announcement[] {
    this.requireTurn(seat);
    const len = Math.sqrt(input.dirX * input.dirX + input.dirY * input.dirY);
    if (!(len > 0.01)) throw invalid('Mire antes de tacar');
    const i = this.turnIndex;
    const onEight = this.onEight(i);
    if (onEight && input.pocket === undefined)
      throw invalid('Cante a caçapa da bola 8');

    const start = this.balls.map((b) => (b ? ([b[0], b[1]] as const) : null));
    if (this.inHand) {
      if (input.cueX === undefined || input.cueY === undefined)
        throw invalid('Coloque a bola branca na mesa');
      if (!canPlaceCue(start, input.cueX, input.cueY, this.isBreak))
        throw invalid(
          this.isBreak
            ? 'Na saída a branca fica atrás da linha'
            : 'A branca não cabe aí',
        );
      start[0] = [input.cueX, input.cueY];
    } else if (!start[0]) {
      start[0] = freeSpot(start, TACADA_HEAD_SPOT);
    }

    const shot = {
      dirX: input.dirX / len,
      dirY: input.dirY / len,
      power: input.power,
      spinX: input.spinX,
      spinY: input.spinY,
    };
    const outcome = simulateShot(start, shot);
    this.lastDurationMs = Math.ceil((outcome.steps / TACADA_SIM_HZ) * 1000);
    this.shotCount++;
    const record: TacadaShotRecord = { ...shot, seat, start };
    const result = this.judge(outcome, onEight, input.pocket);
    return [
      { event: 'tacada:shot', payload: { shot: record, result } },
      ...this.endAnnouncements(),
    ];
  }

  /** The shot clock ran out: a foul (ball in hand for the other player). */
  timeout(): Announcement[] {
    this.requirePlaying();
    const seat = this.turnSeat;
    this.lastDurationMs = 0;
    const out: Announcement[] = [
      { event: 'tacada:turn_timed_out', payload: { seat } },
    ];
    this.foul(this.turnIndex);
    this.last = {
      seat,
      number: this.shotCount,
      pocketed: [],
      foul: 'timeout',
      eightRespotted: false,
      keepsTurn: false,
    };
    return [...out, ...this.endAnnouncements()];
  }

  resign(seat: number): Announcement[] {
    this.requirePlaying();
    this.finish(this.otherSeat(seat), 'resign');
    return [];
  }

  /** The seat is gone (left or did not come back): the other one wins. */
  removePlayer(seat: number): Announcement[] {
    if (this.matchPhase !== 'PLAYING') return [];
    this.finish(this.otherSeat(seat), 'abandoned');
    return [];
  }

  /** Applies the rules to what the physics produced. */
  private judge(
    o: TacadaShotOutcome,
    wasOnEight: boolean,
    calledPocket: number | undefined,
  ): TacadaLastShot {
    const i = this.turnIndex;
    const seat = this.turnSeat;
    const breaking = this.isBreak;
    const myGroup = this.groups[i];
    const pocketed = o.pocketed.map((p) => p.ball);
    const cueIn = pocketed.includes(0);
    const eight = o.pocketed.find((p) => p.ball === 8);
    const objects = pocketed.filter((b) => b !== 0 && b !== 8);
    this.balls = o.balls.map((b) => (b ? ([b[0], b[1]] as const) : null));
    this.isBreak = false;

    // Falta?
    let foul: TacadaFoul | null = null;
    if (cueIn) foul = 'scratch';
    else if (o.firstHit === null) foul = 'no_hit';
    else if (!breaking) {
      const first = o.firstHit;
      if (myGroup === null) {
        if (first === 8) foul = 'wrong_first';
      } else if (wasOnEight) {
        if (first !== 8) foul = 'wrong_first';
      } else if (tacadaGroupOf(first) !== myGroup) foul = 'wrong_first';
      if (!foul && pocketed.length === 0 && !o.railAfterContact)
        foul = 'no_rail';
    }

    const record = (
      keepsTurn: boolean,
      eightRespotted = false,
    ): TacadaLastShot => {
      this.last = {
        seat,
        number: this.shotCount,
        pocketed,
        foul,
        eightRespotted,
        keepsTurn,
      };
      return this.last;
    };

    // A bola 8.
    let eightRespotted = false;
    if (eight) {
      if (breaking) {
        // Regra da casa: a 8 na saída volta para o ponto do pé.
        this.balls[8] = freeSpot(this.balls, TACADA_FOOT_SPOT, 8);
        eightRespotted = true;
      } else {
        const reason: TacadaEndReason | null = !wasOnEight
          ? 'eight_early'
          : foul
            ? 'eight_foul'
            : eight.pocket !== calledPocket
              ? 'eight_wrong_pocket'
              : null;
        if (reason) this.finish(this.otherSeat(seat), reason);
        else this.finish(seat, 'eight');
        return record(false);
      }
    }

    if (foul) {
      if (cueIn) this.balls[0] = null;
      this.foul(i);
      return record(false, eightRespotted);
    }

    this.foulsInARow[i] = 0;
    this.inHand = false;
    // Mesa aberta: o primeiro grupo encaçapado numa tacada normal define os grupos.
    if (!breaking && myGroup === null && objects.length > 0) {
      const group = tacadaGroupOf(objects[0])!;
      this.groups[i] = group;
      this.groups[1 - i] = other(group);
    }
    const group = this.groups[i];
    const scored = breaking
      ? objects.length > 0
      : group === null
        ? false
        : objects.some((b) => tacadaGroupOf(b) === group);
    if (scored) return record(true, eightRespotted);
    this.pass();
    return record(false, eightRespotted);
  }

  private foul(i: number): void {
    this.foulsInARow[i]++;
    if (this.foulsInARow[i] >= TACADA_MAX_FOULS) {
      this.finish(this.seats[1 - i], 'fouls');
      return;
    }
    this.pass();
    this.inHand = true;
  }

  private pass(): void {
    this.turnIndex = 1 - this.turnIndex;
    this.token++;
  }

  private onEight(i: number): boolean {
    const group = this.groups[i];
    return group !== null && tacadaRemaining(this.balls, group) === 0;
  }

  private endAnnouncements(): Announcement[] {
    // Toda tacada reinicia o relógio, mesmo quando o mesmo jogador continua.
    if (this.matchPhase === 'PLAYING') this.token++;
    return [];
  }

  private finish(winner: number, reason: TacadaEndReason): void {
    this.matchPhase = 'OVER';
    this.outcome = { winner, reason };
    this.token++;
  }

  private requirePlaying(): void {
    if (this.matchPhase !== 'PLAYING')
      throw new DomainError('INVALID_STATE', 'A partida já terminou');
  }

  private requireTurn(seat: number): void {
    this.requirePlaying();
    if (seat !== this.turnSeat)
      throw new DomainError('NOT_YOUR_TURN', 'Não é a sua vez');
  }

  private otherSeat(seat: number): number {
    const i = this.seats.indexOf(seat);
    if (i < 0)
      throw new DomainError('INVALID_STATE', 'Você não está nesta partida');
    return this.seats[1 - i];
  }
}
