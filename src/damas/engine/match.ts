import {
  DAMAS_DRAW_MOVES,
  DAMAS_INITIAL_BOARD,
  DAMAS_MAX_TIMEOUTS,
  type DamasEndReason,
  type DamasGameView,
  type DamasLastMove,
  type DamasMatchResult,
  type DamasMove,
  type DamasServerEventPayloads,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';
import {
  applyMove,
  BLACK,
  boardFromString,
  boardToString,
  countPieces,
  legalMoves,
  sameMove,
  WHITE,
  type Board,
  type Side,
} from './rules';

type AnnouncedEvent = {
  [E in keyof DamasServerEventPayloads]: DamasServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof DamasServerEventPayloads];

/** Something that happened in the match; the room adds the sequence number and broadcasts it. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<DamasServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

export type DamasMatchPhase = 'PLAYING' | 'OVER';

const invalidMove = (message: string) =>
  new DomainError('INVALID_MOVE', message);

/**
 * One game of Brazilian draughts between two seats. Pure game logic: no
 * transport, no clock. Every mutating method validates, throws a DomainError
 * when the action is not allowed and returns what happened. `turnToken`
 * changes whenever the turn timer must restart.
 */
export class DamasMatch {
  private readonly board: Board;
  private side: Side = WHITE;
  private moves: DamasMove[];
  private last: DamasLastMove | null = null;
  private quiet = 0;
  private plyCount = 0;
  private offer: number | null = null;
  /** By seat (0/1): ply at which it last offered a draw (one offer per own move). */
  private offeredAt: number[] = [-1, -1];
  /** By seat (0/1): turns timed out in a row. */
  private readonly timeoutsInARow: number[] = [0, 0];
  private matchPhase: DamasMatchPhase = 'PLAYING';
  private outcome: DamasMatchResult | null = null;
  private token = 0;

  /**
   * @param seats the two seats at the table, as [white, black].
   * @param board starting position (tests); the standard one by default.
   */
  constructor(
    private readonly random: RandomInt,
    private readonly seats: readonly [number, number],
    board: string = DAMAS_INITIAL_BOARD,
    first: Side = WHITE,
  ) {
    this.board = boardFromString(board);
    this.side = first;
    this.moves = legalMoves(this.board, this.side);
  }

  get phase(): DamasMatchPhase {
    return this.matchPhase;
  }

  get result(): DamasMatchResult | null {
    return this.outcome;
  }

  get turnToken(): number {
    return this.token;
  }

  /** Seat whose turn it is. */
  get turnSeat(): number {
    return this.seatOf(this.side);
  }

  publicView(): Omit<DamasGameView, 'turnDeadline'> {
    return {
      board: boardToString(this.board),
      turn: this.side === WHITE ? 'white' : 'black',
      moves: this.matchPhase === 'PLAYING' ? this.moves.map(copyMove) : [],
      lastMove: this.last ? { ...this.last, ...copyMove(this.last) } : null,
      quietMoves: this.quiet,
      plies: this.plyCount,
      drawOffer: this.offer,
      timeouts: [...this.timeoutsInARow],
    };
  }

  move(seat: number, from: number, path: readonly number[]): Announcement[] {
    this.requireTurn(seat);
    const move = this.moves.find((m) => sameMove(m, from, path));
    if (!move) {
      const capturing = this.moves[0]?.captures.length ?? 0;
      throw invalidMove(
        capturing > 0
          ? `Captura obrigatória: escolha um lance que capture ${capturing} ${capturing === 1 ? 'peça' : 'peças'}`
          : 'Lance inválido',
      );
    }
    this.timeoutsInARow[seat] = 0;
    return this.play(move);
  }

  /** The turn ran out: a random legal move is played; too many in a row loses. */
  timeout(): Announcement[] {
    this.requirePlaying();
    const seat = this.turnSeat;
    this.timeoutsInARow[seat]++;
    const out: Announcement[] = [
      { event: 'damas:turn_timed_out', payload: { seat } },
    ];
    if (this.timeoutsInARow[seat] >= DAMAS_MAX_TIMEOUTS) {
      out.push(...this.finish(this.otherSeat(seat), 'timeout'));
      return out;
    }
    const move = this.moves[this.random(0, this.moves.length)];
    out.push(...this.play(move));
    return out;
  }

  resign(seat: number): Announcement[] {
    this.requirePlaying();
    return this.finish(this.otherSeat(seat), 'resign');
  }

  /** The seat is gone (left or did not come back): the other one wins. */
  removePlayer(seat: number): Announcement[] {
    if (this.matchPhase !== 'PLAYING') return [];
    return this.finish(this.otherSeat(seat), 'abandoned');
  }

  offerDraw(seat: number): Announcement[] {
    this.requirePlaying();
    if (this.offer !== null)
      throw new DomainError(
        'INVALID_STATE',
        'Já existe uma proposta de empate',
      );
    this.indexOf(seat);
    if (this.offeredAt[seat] === this.plyCount)
      throw new DomainError(
        'INVALID_STATE',
        'Jogue um lance antes de propor empate de novo',
      );
    this.offer = seat;
    this.offeredAt[seat] = this.plyCount;
    return [{ event: 'damas:draw_offered', payload: { seat } }];
  }

  answerDraw(seat: number, accept: boolean): Announcement[] {
    this.requirePlaying();
    if (this.offer === null || this.offer === seat)
      throw new DomainError(
        'INVALID_STATE',
        'Não há proposta de empate para responder',
      );
    this.offer = null;
    if (accept) return this.finish(null, 'draw_agreed');
    return [{ event: 'damas:draw_declined', payload: { seat } }];
  }

  private play(move: DamasMove): Announcement[] {
    const seat = this.turnSeat;
    const king = Math.abs(this.board[move.from]) === 2;
    const promoted = applyMove(this.board, move);
    this.last = { ...copyMove(move), seat, promoted };
    this.plyCount++;
    this.quiet = king && move.captures.length === 0 ? this.quiet + 1 : 0;
    // Moving answers a pending offer from the opponent with a silent "no".
    if (this.offer !== null && this.offer !== seat) this.offer = null;
    this.side = this.side === WHITE ? BLACK : WHITE;
    this.moves = legalMoves(this.board, this.side);
    this.token++;
    const out: Announcement[] = [
      {
        event: 'damas:moved',
        payload: {
          ...this.last,
          path: [...move.path],
          captures: [...move.captures],
        },
      },
    ];
    if (countPieces(this.board, this.side) === 0)
      out.push(...this.finish(seat, 'no_pieces'));
    else if (this.moves.length === 0) out.push(...this.finish(seat, 'blocked'));
    else if (this.quiet >= 2 * DAMAS_DRAW_MOVES)
      out.push(...this.finish(null, 'draw_moves'));
    return out;
  }

  private finish(
    winner: number | null,
    reason: DamasEndReason,
  ): Announcement[] {
    this.matchPhase = 'OVER';
    this.offer = null;
    this.outcome = { winner, reason };
    this.token++;
    return [];
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

  private seatOf(side: Side): number {
    return side === WHITE ? this.seats[0] : this.seats[1];
  }

  private indexOf(seat: number): number {
    const i = this.seats.indexOf(seat);
    if (i < 0)
      throw new DomainError('INVALID_STATE', 'Você não está nesta partida');
    return i;
  }

  private otherSeat(seat: number): number {
    return this.seats[1 - this.indexOf(seat)];
  }
}

const copyMove = (m: DamasMove): DamasMove => ({
  from: m.from,
  path: [...m.path],
  captures: [...m.captures],
});
