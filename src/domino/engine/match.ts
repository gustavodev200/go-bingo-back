import {
  DOMINO_HAND_SIZE,
  DOMINO_MIN_PLAYERS,
  DOMINO_SEATS,
  dominoTeamOf,
  isDouble,
  tilePips,
  type DominoPlaced,
  type DominoPlayable,
  type DominoPrivateHand,
  type DominoRoundResult,
  type DominoRoundView,
  type DominoRules,
  type DominoServerEventPayloads,
  type DominoSide,
  type DominoTile,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';
import { shuffle } from '../../truco/engine/cards';
import { hasPip, newDominoSet } from './tiles';

type AnnouncedEvent = {
  [E in keyof DominoServerEventPayloads]: DominoServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof DominoServerEventPayloads];

/** Something that happened in the match; the room adds the sequence number and broadcasts it. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<DominoServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

export type DominoMatchPhase = 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER';

interface DealtTile {
  id: string;
  tile: DominoTile;
}

const invalidMove = (message: string) =>
  new DomainError('INVALID_MOVE', message);

const handPips = (hand: readonly DealtTile[]) =>
  hand.reduce((sum, t) => sum + tilePips(t.tile), 0);

/**
 * Classic double-six dominoes for one match among 2–4 seats (alone or 2
 * against 2), a single round or rounds until a target score. Pure game logic:
 * no transport, no clock. Every mutating method validates the move, throws a
 * DomainError when it is not allowed and returns what happened. `turnToken`
 * changes whenever the turn timer must restart.
 *
 * Play goes up the seat numbers, which the tables draw anti-clockwise.
 */
export class DominoMatch {
  readonly scores: number[];
  private active: number[];
  private hands: DealtTile[][] = Array.from({ length: DOMINO_SEATS }, () => []);
  private boneyard: DealtTile[] = [];
  private line: DominoPlaced[] = [];
  private origin = 0;
  private turnSeat = 0;
  /** Tile that must open the round (highest double, or heaviest tile). */
  private opening: string | null = null;
  /** Who opens the next round: the last winner. */
  private nextStarter: number | null = null;
  private roundNumber = 0;
  private matchPhase: DominoMatchPhase = 'ROUND_OVER';
  private winnerSeats: number[] | null = null;
  private lastRound: DominoRoundResult | null = null;
  private token = 0;
  private readonly setSource: () => DominoTile[];

  constructor(
    private readonly random: RandomInt,
    seats: readonly number[],
    private readonly rules: DominoRules,
    init: {
      /** Test hook: hands are dealt in seat order from the start of this set. */
      tiles?: () => DominoTile[];
      scores?: number[];
    } = {},
  ) {
    if (seats.length < DOMINO_MIN_PLAYERS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'O dominó precisa de pelo menos 2 jogadores',
      );
    if (rules.teams && seats.length !== DOMINO_SEATS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'Em duplas a mesa precisa de 4 jogadores',
      );
    this.active = [...seats].sort((a, b) => a - b);
    this.setSource = init.tiles ?? (() => shuffle(newDominoSet(), this.random));
    this.scores = init.scores
      ? [...init.scores]
      : Array<number>(DOMINO_SEATS).fill(0);
  }

  get phase(): DominoMatchPhase {
    return this.matchPhase;
  }

  get turn(): number {
    return this.turnSeat;
  }

  get turnToken(): number {
    return this.token;
  }

  /** Seats that won the match (empty on a tie); null while it runs. */
  get winners(): number[] | null {
    return this.winnerSeats;
  }

  /**
   * Deals 7 tiles to each seat; the rest is the boneyard. The first round
   * (or one after a tie) is opened by the highest double, or the heaviest
   * tile when nobody holds a double; later rounds by the last winner.
   */
  startRound(): Announcement[] {
    if (this.matchPhase === 'MATCH_OVER')
      throw new DomainError('INVALID_STATE', 'A partida já terminou');
    if (this.matchPhase === 'PLAYING')
      throw new DomainError(
        'INVALID_STATE',
        'A rodada ainda está em andamento',
      );
    const round = ++this.roundNumber;
    // Ids are given after the shuffle: they tell nothing about the tile.
    const set = this.setSource().map((tile, i) => ({
      id: `r${round}t${i}`,
      tile,
    }));
    this.hands = Array.from({ length: DOMINO_SEATS }, () => []);
    for (const seat of this.active)
      this.hands[seat] = set.splice(0, DOMINO_HAND_SIZE);
    this.boneyard = set;
    this.line = [];
    this.origin = 0;
    this.matchPhase = 'PLAYING';

    if (this.nextStarter !== null && this.active.includes(this.nextStarter)) {
      this.turnSeat = this.nextStarter;
      this.opening = null;
    } else {
      const open = this.openingTile();
      this.turnSeat = open.seat;
      this.opening = open.id;
    }
    this.token++;
    return [
      {
        event: 'domino:round_started',
        payload: { roundNumber: round, starter: this.turnSeat },
      },
    ];
  }

  /** Places a tile at one end of the line. `side` is needed only when it fits both ends with different numbers. */
  play(seat: number, tileId: string, side?: DominoSide): Announcement[] {
    this.assertTurn(seat);
    const hand = this.hands[seat];
    const index = hand.findIndex((t) => t.id === tileId);
    if (index < 0) throw invalidMove('Essa peça não está na sua mão');
    const dealt = hand[index];
    const sides = this.sidesFor(dealt);
    if (sides.length === 0)
      throw invalidMove(
        this.opening && this.line.length === 0
          ? 'A rodada abre com a maior carroça'
          : 'Essa peça não encaixa',
      );
    let at: DominoSide;
    if (side) {
      if (!sides.includes(side)) throw invalidMove('Essa peça não encaixa aí');
      at = side;
    } else if (sides.length === 1) at = sides[0];
    else if (this.ends![0] === this.ends![1]) at = this.shorterArm();
    else throw invalidMove('Escolha em qual ponta jogar');

    hand.splice(index, 1);
    this.place(dealt.tile, at, seat);
    this.opening = null;
    const out: Announcement[] = [
      {
        event: 'domino:tile_played',
        payload: {
          seat,
          tile: { ...dealt.tile },
          side: at,
          tilesLeft: hand.length,
        },
      },
    ];
    if (hand.length === 0) {
      out.push(...this.endRound(seat));
      return out;
    }
    out.push(...this.advance(seat));
    return out;
  }

  /** No tile fits: buys from the boneyard until one fits or it runs out (then the turn passes). */
  draw(seat: number): Announcement[] {
    this.assertTurn(seat);
    if (this.hasPlayable(seat))
      throw invalidMove('Você tem peça que encaixa: jogue');
    if (this.boneyard.length === 0) throw invalidMove('O monte acabou');
    const out = this.buy(seat);
    if (this.hasPlayable(seat)) this.token++;
    else out.push(this.passed(seat), ...this.advance(seat));
    return out;
  }

  /** The turn ran out: buy if needed, then play the heaviest tile that fits (or pass). */
  timeout(): Announcement[] {
    this.assertPlaying();
    const seat = this.turnSeat;
    const out: Announcement[] = [
      { event: 'domino:turn_timed_out', payload: { seat } },
    ];
    if (!this.hasPlayable(seat) && this.boneyard.length > 0)
      out.push(...this.buy(seat));
    const best = this.playableOf(seat).sort(
      (x, y) =>
        tilePips(this.tileById(seat, y.id)) -
        tilePips(this.tileById(seat, x.id)),
    )[0];
    if (best) out.push(...this.play(seat, best.id, best.sides[0]));
    else out.push(this.passed(seat), ...this.advance(seat));
    return out;
  }

  /**
   * A player left the match. Alone, their tiles go back to the boneyard and
   * the match goes on until one player is left, who wins. In 2 against 2 the
   * team without them wins at once.
   */
  removePlayer(seat: number): Announcement[] {
    if (!this.active.includes(seat)) return [];
    const wasTurn = this.matchPhase === 'PLAYING' && this.turnSeat === seat;
    const nextTurn = wasTurn ? this.next(seat) : this.turnSeat;
    const leftTiles = this.hands[seat];
    this.hands[seat] = [];
    this.active = this.active.filter((s) => s !== seat);
    if (this.rules.teams) {
      const team = dominoTeamOf(seat);
      return this.finish(this.active.filter((s) => dominoTeamOf(s) !== team));
    }
    if (this.active.length === 1) return this.finish([...this.active]);
    if (this.matchPhase !== 'PLAYING') return [];
    if (leftTiles.some((t) => t.id === this.opening)) this.opening = null;
    this.boneyard = shuffle([...this.boneyard, ...leftTiles], this.random);
    if (!wasTurn) return [];
    this.turnSeat = nextTurn;
    this.token++;
    return this.resolveStuck();
  }

  publicView(): DominoRoundView {
    return {
      roundNumber: this.roundNumber,
      phase: this.matchPhase === 'PLAYING' ? 'PLAYING' : 'ROUND_OVER',
      turn: this.turnSeat,
      line: this.line.map((p) => ({ ...p })),
      origin: this.origin,
      ends: this.ends,
      boneyard: this.boneyard.length,
      handCounts: this.hands.map((h) => h.length),
      lastRound: this.lastRound,
      turnDeadline: null,
    };
  }

  /** The seat's own tiles and what it may play now; null for seats out of the match. */
  privateView(seat: number): DominoPrivateHand | null {
    if (!this.active.includes(seat)) return null;
    const myTurn = this.matchPhase === 'PLAYING' && this.turnSeat === seat;
    const playable = myTurn ? this.playableOf(seat) : [];
    return {
      roundNumber: this.roundNumber,
      tiles: this.hands[seat].map((t) => ({ id: t.id, tile: { ...t.tile } })),
      playable,
      mustDraw: myTurn && playable.length === 0 && this.boneyard.length > 0,
    };
  }

  private get ends(): [number, number] | null {
    if (this.line.length === 0) return null;
    return [this.line[0].a, this.line[this.line.length - 1].b];
  }

  private openingTile(): { seat: number; id: string } {
    let best: { seat: number; id: string; rank: number } | null = null;
    for (const seat of this.active)
      for (const t of this.hands[seat]) {
        // Doubles first (6|6 down to 0|0), then the heaviest tile, then its highest side.
        const rank = isDouble(t.tile)
          ? 1000 + t.tile.a
          : tilePips(t.tile) * 10 + t.tile.b;
        if (!best || rank > best.rank) best = { seat, id: t.id, rank };
      }
    return best!;
  }

  private sidesFor(dealt: DealtTile): DominoSide[] {
    const ends = this.ends;
    if (!ends)
      return !this.opening || dealt.id === this.opening ? ['right'] : [];
    const out: DominoSide[] = [];
    if (hasPip(dealt.tile, ends[0])) out.push('left');
    if (hasPip(dealt.tile, ends[1])) out.push('right');
    return out;
  }

  private playableOf(seat: number): DominoPlayable[] {
    return this.hands[seat].flatMap((t) => {
      const sides = this.sidesFor(t);
      return sides.length ? [{ id: t.id, sides }] : [];
    });
  }

  private hasPlayable(seat: number): boolean {
    return this.hands[seat].some((t) => this.sidesFor(t).length > 0);
  }

  private tileById(seat: number, id: string): DominoTile {
    return this.hands[seat].find((t) => t.id === id)!.tile;
  }

  /** Both ends show the same number: grow the arm with fewer tiles, so the layout stays balanced. */
  private shorterArm(): DominoSide {
    const left = this.origin;
    const right = this.line.length - 1 - this.origin;
    return left < right ? 'left' : 'right';
  }

  private place(tile: DominoTile, side: DominoSide, seat: number): void {
    const ends = this.ends;
    if (!ends) {
      this.line = [{ a: tile.a, b: tile.b, seat }];
      this.origin = 0;
    } else if (side === 'left') {
      const placed =
        tile.b === ends[0]
          ? { a: tile.a, b: tile.b, seat }
          : { a: tile.b, b: tile.a, seat };
      this.line.unshift(placed);
      this.origin++;
    } else {
      const placed =
        tile.a === ends[1]
          ? { a: tile.a, b: tile.b, seat }
          : { a: tile.b, b: tile.a, seat };
      this.line.push(placed);
    }
  }

  /** Buys until a tile fits or the boneyard is empty. */
  private buy(seat: number): Announcement[] {
    let count = 0;
    while (this.boneyard.length > 0 && !this.hasPlayable(seat)) {
      this.hands[seat].push(this.boneyard.shift()!);
      count++;
    }
    return [{ event: 'domino:tiles_drawn', payload: { seat, count } }];
  }

  private passed(seat: number): Announcement {
    return { event: 'domino:turn_passed', payload: { seat } };
  }

  /** Moves the turn on and skips everyone who can neither play nor buy. */
  private advance(from: number): Announcement[] {
    this.turnSeat = this.next(from);
    this.token++;
    return this.resolveStuck();
  }

  private resolveStuck(): Announcement[] {
    if (this.boneyard.length > 0) return [];
    if (!this.active.some((s) => this.hasPlayable(s)))
      return this.endRound(null);
    const out: Announcement[] = [];
    while (!this.hasPlayable(this.turnSeat)) {
      out.push(this.passed(this.turnSeat));
      this.turnSeat = this.next(this.turnSeat);
    }
    this.token++;
    return out;
  }

  /**
   * Ends the round: `domino` is who played their last tile, null when the game
   * blocked (the lowest hand, or team, wins; a tie scores nothing). Winners add
   * the pips left in the losers' hands.
   */
  private endRound(domino: number | null): Announcement[] {
    const pips = this.hands.map(handPips);
    const teams = this.rules.teams;
    let winners: number[];
    if (domino !== null)
      winners = teams
        ? this.active.filter((s) => dominoTeamOf(s) === dominoTeamOf(domino))
        : [domino];
    else if (teams) {
      const sum = [0, 1].map((team) =>
        this.active
          .filter((s) => dominoTeamOf(s) === team)
          .reduce((acc, s) => acc + pips[s], 0),
      );
      winners =
        sum[0] === sum[1]
          ? []
          : this.active.filter(
              (s) => dominoTeamOf(s) === (sum[0] < sum[1] ? 0 : 1),
            );
    } else {
      const low = Math.min(...this.active.map((s) => pips[s]));
      const lowest = this.active.filter((s) => pips[s] === low);
      winners = lowest.length === 1 ? lowest : [];
    }
    const points = winners.length
      ? this.active
          .filter((s) => !winners.includes(s))
          .reduce((acc, s) => acc + pips[s], 0)
      : 0;
    for (const s of winners) this.scores[s] += points;
    this.lastRound = { winners, points, blocked: domino === null, pips };
    this.nextStarter =
      domino ??
      (winners.length
        ? winners.reduce((a, b) => (pips[b] < pips[a] ? b : a))
        : null);
    const target = this.rules.target;
    const reached =
      target === 0 || winners.some((s) => this.scores[s] >= target);
    this.matchPhase = reached ? 'MATCH_OVER' : 'ROUND_OVER';
    if (reached) this.winnerSeats = [...winners];
    this.token++;
    return [
      {
        event: 'domino:round_ended',
        payload: { ...this.lastRound, scores: [...this.scores] },
      },
    ];
  }

  private finish(winners: number[]): Announcement[] {
    this.winnerSeats = winners;
    this.matchPhase = 'MATCH_OVER';
    this.token++;
    return [];
  }

  /** The next seat in play order (up the seat numbers, wrapping). */
  private next(from: number): number {
    return this.active.find((s) => s > from) ?? this.active[0];
  }

  private assertPlaying(): void {
    if (this.matchPhase !== 'PLAYING')
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private assertTurn(seat: number): void {
    this.assertPlaying();
    if (!this.active.includes(seat))
      throw new DomainError('INVALID_STATE', 'Você não está na partida');
    if (seat !== this.turnSeat)
      throw new DomainError('NOT_YOUR_TURN', 'Não é a sua vez');
  }
}
