import {
  cardPoints,
  UNO_HAND_SIZE,
  UNO_MIN_PLAYERS,
  UNO_SEATS,
  type UnoCard,
  type UnoColor,
  type UnoDirection,
  type UnoDrawReason,
  type UnoPlayOptions,
  type UnoPrivateHand,
  type UnoRoundResult,
  type UnoRoundView,
  type UnoRules,
  type UnoServerEventPayloads,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';
import { shuffle } from '../../truco/engine/cards';
import { canPlayOn, newUnoDeck } from './deck';

type AnnouncedEvent = {
  [E in keyof UnoServerEventPayloads]: UnoServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof UnoServerEventPayloads];

/** Something that happened in the match; the room adds the sequence number and broadcasts it. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<UnoServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

export type UnoMatchPhase = 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER';

interface DealtCard {
  id: string;
  card: UnoCard;
}

const invalidMove = (message: string) =>
  new DomainError('INVALID_MOVE', message);

/**
 * UNO rules for one match among 2–6 seats (a single round, or rounds until a
 * seat reaches the target score). Pure game logic: no transport, no clock.
 * Every mutating method validates the move, throws a DomainError when it is
 * not allowed and returns what happened. `turnToken` changes whenever the
 * turn timer must restart.
 */
export class UnoMatch {
  readonly scores: number[];
  private active: number[];
  private hands: DealtCard[][] = Array.from({ length: UNO_SEATS }, () => []);
  private drawPile: DealtCard[] = [];
  private discard: DealtCard[] = [];
  private color: UnoColor = 'red';
  private direction: UnoDirection = 1;
  private turnSeat = 0;
  /** Cards the turn player must draw (from +2/+4, summed when stacking). */
  private pendingDraw = 0;
  /** The +4 on top can be challenged: who played it and whether they held the color. */
  private challengeable: { by: number; bluffed: boolean } | null = null;
  /** Card the turn player just drew and may still play. */
  private drawnId: string | null = null;
  private saidUno: boolean[] = Array<boolean>(UNO_SEATS).fill(false);
  private exposed: number | null = null;
  private roundNumber = 0;
  private starter: number;
  private matchPhase: UnoMatchPhase = 'ROUND_OVER';
  private winnerSeat: number | null = null;
  private lastRound: UnoRoundResult | null = null;
  private token = 0;
  private readonly deckSource: () => UnoCard[];
  private readonly handSize: number;

  constructor(
    private readonly random: RandomInt,
    seats: readonly number[],
    private readonly rules: UnoRules,
    init: {
      /** Test hook: hands are dealt in seat order from the start of this deck. */
      deck?: () => UnoCard[];
      starter?: number;
      handSize?: number;
      scores?: number[];
    } = {},
  ) {
    if (seats.length < UNO_MIN_PLAYERS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'O UNO precisa de pelo menos 2 jogadores',
      );
    this.active = [...seats].sort((a, b) => a - b);
    this.deckSource = init.deck ?? (() => shuffle(newUnoDeck(), this.random));
    this.handSize = init.handSize ?? UNO_HAND_SIZE;
    this.starter = init.starter ?? this.active[random(0, this.active.length)];
    this.scores = init.scores
      ? [...init.scores]
      : Array<number>(UNO_SEATS).fill(0);
  }

  get phase(): UnoMatchPhase {
    return this.matchPhase;
  }

  get turn(): number {
    return this.turnSeat;
  }

  get turnToken(): number {
    return this.token;
  }

  get winner(): number | null {
    return this.winnerSeat;
  }

  /** Deals a round. From the second one on, the starter moves to the next seat. */
  startRound(): Announcement[] {
    if (this.matchPhase === 'MATCH_OVER')
      throw new DomainError('INVALID_STATE', 'A partida já terminou');
    if (this.matchPhase === 'PLAYING')
      throw new DomainError(
        'INVALID_STATE',
        'A rodada ainda está em andamento',
      );
    if (this.roundNumber > 0) this.starter = this.nextInSeatOrder(this.starter);
    const round = ++this.roundNumber;
    // Ids are given after the shuffle: they tell nothing about the card.
    const deck = this.deckSource().map((card, i) => ({
      id: `r${round}c${i}`,
      card,
    }));
    this.hands = Array.from({ length: UNO_SEATS }, () => []);
    for (const seat of this.active)
      this.hands[seat] = deck.splice(0, this.handSize);
    this.drawPile = deck;
    this.discard = [];
    let top = this.drawPile.shift()!;
    // A wild first card goes back under the pile.
    for (let i = 0; top.card.color === 'wild' && i < deck.length; i++) {
      this.drawPile.push(top);
      top = this.drawPile.shift()!;
    }
    this.discard.push(top);
    this.color = top.card.color === 'wild' ? 'red' : top.card.color;
    this.direction = 1;
    this.turnSeat = this.starter;
    this.pendingDraw = 0;
    this.challengeable = null;
    this.drawnId = null;
    this.saidUno.fill(false);
    this.exposed = null;
    this.matchPhase = 'PLAYING';

    const out: Announcement[] = [
      {
        event: 'uno:round_started',
        payload: {
          roundNumber: round,
          starter: this.starter,
          topCard: top.card,
        },
      },
    ];
    const first = this.starter;
    switch (top.card.value) {
      case 'skip':
        out.push(this.skipped(first));
        this.turnSeat = this.next(first);
        break;
      case 'reverse':
        if (this.active.length === 2) out.push(this.skipped(first));
        else {
          this.direction = -1;
          out.push(this.directionChanged());
        }
        this.turnSeat = this.next(first);
        break;
      case 'draw2':
        out.push(...this.give(first, 2, 'penalty').out);
        this.turnSeat = this.next(first);
        break;
    }
    this.token++;
    return out;
  }

  play(seat: number, cardId: string, opts: UnoPlayOptions): Announcement[] {
    this.assertTurn(seat);
    const hand = this.hands[seat];
    const index = hand.findIndex((c) => c.id === cardId);
    if (index < 0) throw invalidMove('Essa carta não está na sua mão');
    const dealt = hand[index];
    if (!this.isPlayable(dealt))
      throw invalidMove('Essa carta não serve agora');
    const { card } = dealt;
    if (card.color === 'wild' && !opts.color)
      throw invalidMove('Escolha uma cor');
    const swapsHands =
      this.rules.sevenZero && card.value === '7' && hand.length > 1;
    if (
      swapsHands &&
      (opts.target === undefined ||
        opts.target === seat ||
        !this.active.includes(opts.target))
    )
      throw invalidMove('Escolha com quem trocar de mão');

    this.closeExposure(seat);
    const stacked = this.pendingDraw > 0;
    const bluffed =
      card.value === 'wild4' &&
      hand.some((c) => c.id !== cardId && c.card.color === this.color);
    hand.splice(index, 1);
    this.discard.push(dealt);
    this.color = card.color === 'wild' ? opts.color! : card.color;
    this.drawnId = null;
    this.challengeable = null;
    if (hand.length === 1 && !this.saidUno[seat]) this.exposed = seat;

    const out: Announcement[] = [
      {
        event: 'uno:card_played',
        payload: { seat, card, color: this.color, cardsLeft: hand.length },
      },
    ];

    if (hand.length === 0) {
      // A final +2/+4 still counts: the next player draws before the score.
      if (card.value === 'draw2' || card.value === 'wild4') {
        const amount = this.pendingDraw + (card.value === 'draw2' ? 2 : 4);
        out.push(...this.give(this.next(seat), amount, 'penalty').out);
        this.pendingDraw = 0;
      }
      out.push(...this.endRound(seat));
      return out;
    }

    switch (card.value) {
      case 'skip':
        out.push(this.skipped(this.next(seat)));
        this.turnSeat = this.next(seat, 2);
        break;
      case 'reverse':
        if (this.active.length === 2) {
          out.push(this.skipped(this.next(seat)));
          this.turnSeat = seat;
        } else {
          this.direction = this.direction === 1 ? -1 : 1;
          out.push(this.directionChanged());
          this.turnSeat = this.next(seat);
        }
        break;
      case 'draw2':
        this.pendingDraw += 2;
        this.turnSeat = this.next(seat);
        if (!this.rules.stacking)
          out.push(...this.resolvePending(this.turnSeat));
        break;
      case 'wild4':
        this.pendingDraw += 4;
        this.turnSeat = this.next(seat);
        if (!stacked) this.challengeable = { by: seat, bluffed };
        break;
      default:
        if (swapsHands) out.push(this.swapHands(seat, opts.target!));
        else if (this.rules.sevenZero && card.value === '0')
          out.push(this.rotateHands());
        this.turnSeat = this.next(seat);
    }
    this.token++;
    return out;
  }

  /** Draws the pending cards, or one card by choice (keeping the turn if it fits). */
  draw(seat: number): Announcement[] {
    this.assertTurn(seat);
    if (this.drawnId)
      throw invalidMove('Jogue ou passe a carta que você comprou');
    this.closeExposure(seat);
    let out: Announcement[];
    if (this.pendingDraw > 0) out = this.resolvePending(seat);
    else {
      const drawn = this.give(seat, 1, 'choice');
      out = drawn.out;
      const got = drawn.cards[0];
      if (got && canPlayOn(got.card, this.top.card, this.color))
        this.drawnId = got.id;
      else this.turnSeat = this.next(seat);
    }
    this.token++;
    return out;
  }

  /** Keeps the card just drawn and ends the turn. */
  pass(seat: number): Announcement[] {
    this.assertTurn(seat);
    if (!this.drawnId) throw invalidMove('Compre uma carta antes de passar');
    this.closeExposure(seat);
    this.drawnId = null;
    this.turnSeat = this.next(seat);
    this.token++;
    return [];
  }

  /**
   * Challenges the +4 on top. A bluff (the player held the color to follow)
   * makes them draw the 4 and the challenger plays normally; otherwise the
   * challenger draws 6 and loses the turn.
   */
  challenge(seat: number): Announcement[] {
    this.assertTurn(seat);
    const target = this.challengeable;
    if (!target || this.pendingDraw === 0)
      throw invalidMove('Não há +4 para desafiar');
    this.closeExposure(seat);
    this.challengeable = null;
    const out: Announcement[] = [
      {
        event: 'uno:challenge_resolved',
        payload: {
          challenger: seat,
          target: target.by,
          bluffed: target.bluffed,
        },
      },
    ];
    if (target.bluffed) {
      out.push(...this.give(target.by, this.pendingDraw, 'challenge').out);
      this.pendingDraw = 0;
    } else {
      out.push(...this.give(seat, this.pendingDraw + 2, 'challenge').out);
      this.pendingDraw = 0;
      this.turnSeat = this.next(seat);
    }
    this.token++;
    return out;
  }

  /** "UNO!": with one card not yet announced, or with two on your turn about to play one. */
  callUno(seat: number): Announcement[] {
    this.assertSeated(seat);
    const hand = this.hands[seat];
    const allowed =
      (hand.length === 1 && !this.saidUno[seat]) ||
      (hand.length === 2 &&
        this.turnSeat === seat &&
        hand.some((c) => this.isPlayable(c)));
    if (!allowed)
      throw invalidMove('Só dá para gritar UNO com uma ou duas cartas');
    this.saidUno[seat] = true;
    if (this.exposed === seat) this.exposed = null;
    return [{ event: 'uno:uno_called', payload: { seat } }];
  }

  /** Catches the exposed player (one card, no UNO): they draw 2. */
  catchUno(seat: number): Announcement[] {
    this.assertSeated(seat);
    const victim = this.exposed;
    if (victim === null || victim === seat)
      throw invalidMove('Não tem ninguém para pegar');
    this.exposed = null;
    return [
      { event: 'uno:uno_caught', payload: { seat: victim, by: seat } },
      ...this.give(victim, 2, 'uno').out,
    ];
  }

  /** The turn ran out: keep the drawn card, draw the pending cards, or draw one and pass. */
  timeout(): Announcement[] {
    this.assertPlaying();
    const seat = this.turnSeat;
    this.closeExposure(seat);
    const out: Announcement[] = [
      { event: 'uno:turn_timed_out', payload: { seat } },
    ];
    if (this.drawnId) {
      this.drawnId = null;
      this.turnSeat = this.next(seat);
    } else if (this.pendingDraw > 0) out.push(...this.resolvePending(seat));
    else {
      out.push(...this.give(seat, 1, 'timeout').out);
      this.turnSeat = this.next(seat);
    }
    this.token++;
    return out;
  }

  /**
   * A player left the match: their cards go under the draw pile and the turn
   * moves on if it was theirs. With one player left, that player wins.
   */
  removePlayer(seat: number): Announcement[] {
    if (!this.active.includes(seat)) return [];
    const wasTurn = this.matchPhase === 'PLAYING' && this.turnSeat === seat;
    const nextTurn = wasTurn ? this.next(seat) : this.turnSeat;
    if (wasTurn) {
      this.pendingDraw = 0;
      this.challengeable = null;
      this.drawnId = null;
    }
    if (this.challengeable?.by === seat) this.challengeable = null;
    this.drawPile.push(...this.hands[seat]);
    this.hands[seat] = [];
    this.saidUno[seat] = false;
    if (this.exposed === seat) this.exposed = null;
    this.active = this.active.filter((s) => s !== seat);
    if (this.active.length === 1) {
      this.winnerSeat = this.active[0];
      this.matchPhase = 'MATCH_OVER';
      this.token++;
      return [];
    }
    if (wasTurn) {
      this.turnSeat = nextTurn;
      this.token++;
    }
    return [];
  }

  publicView(): UnoRoundView {
    return {
      roundNumber: this.roundNumber,
      phase: this.matchPhase === 'PLAYING' ? 'PLAYING' : 'ROUND_OVER',
      turn: this.turnSeat,
      direction: this.direction,
      topCard: { ...this.top.card },
      color: this.color,
      drawPile: this.drawPile.length,
      discardCount: this.discard.length,
      handCounts: this.hands.map((h) => h.length),
      pendingDraw: this.pendingDraw,
      canChallenge: this.challengeable !== null && this.pendingDraw > 0,
      awaitingDrawn: this.drawnId !== null,
      saidUno: [...this.saidUno],
      unoExposed: this.exposed,
      lastRound: this.lastRound,
      turnDeadline: null,
    };
  }

  /** The seat's own cards and what it may play now; null for seats out of the match. */
  privateView(seat: number): UnoPrivateHand | null {
    if (!this.active.includes(seat)) return null;
    const myTurn = this.matchPhase === 'PLAYING' && this.turnSeat === seat;
    const hand = this.hands[seat];
    return {
      roundNumber: this.roundNumber,
      cards: hand.map((c) => ({ id: c.id, card: { ...c.card } })),
      playable: myTurn
        ? hand.filter((c) => this.isPlayable(c)).map((c) => c.id)
        : [],
      drawnCardId: myTurn ? this.drawnId : null,
    };
  }

  private get top(): DealtCard {
    return this.discard[this.discard.length - 1];
  }

  private isPlayable(dealt: DealtCard): boolean {
    if (this.drawnId !== null) return dealt.id === this.drawnId;
    if (this.pendingDraw > 0) {
      if (!this.rules.stacking) return false;
      const top = this.top.card.value;
      return (
        (dealt.card.value === 'draw2' && top === 'draw2') ||
        (dealt.card.value === 'wild4' && (top === 'draw2' || top === 'wild4'))
      );
    }
    return canPlayOn(dealt.card, this.top.card, this.color);
  }

  private resolvePending(victim: number): Announcement[] {
    const out = this.give(victim, this.pendingDraw, 'penalty').out;
    this.pendingDraw = 0;
    this.challengeable = null;
    this.turnSeat = this.next(victim);
    return out;
  }

  /** Moves up to `count` cards from the pile to the seat (reshuffling the discards when needed). */
  private give(
    seat: number,
    count: number,
    reason: UnoDrawReason,
  ): { out: Announcement[]; cards: DealtCard[] } {
    const cards: DealtCard[] = [];
    for (let i = 0; i < count; i++) {
      if (this.drawPile.length === 0) this.reshuffle();
      const next = this.drawPile.shift();
      if (!next) break;
      cards.push(next);
    }
    const hand = this.hands[seat];
    hand.push(...cards);
    if (hand.length > 1) {
      this.saidUno[seat] = false;
      if (this.exposed === seat) this.exposed = null;
    }
    return {
      cards,
      out: [
        {
          event: 'uno:cards_drawn',
          payload: { seat, count: cards.length, reason },
        },
      ],
    };
  }

  private reshuffle(): void {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop()!;
    this.drawPile = shuffle(this.discard, this.random);
    this.discard = [top];
  }

  private swapHands(seat: number, target: number): Announcement {
    [this.hands[seat], this.hands[target]] = [
      this.hands[target],
      this.hands[seat],
    ];
    this.resetUno();
    return { event: 'uno:hands_swapped', payload: { seat, target } };
  }

  private rotateHands(): Announcement {
    const before = this.hands.map((h) => h);
    for (const seat of this.active) this.hands[this.next(seat)] = before[seat];
    this.resetUno();
    return {
      event: 'uno:hands_rotated',
      payload: { direction: this.direction },
    };
  }

  /** Hands changed owners: every UNO call and exposure starts over. */
  private resetUno(): void {
    this.saidUno.fill(false);
    this.exposed = null;
  }

  private endRound(winner: number): Announcement[] {
    const points = this.active
      .filter((s) => s !== winner)
      .reduce(
        (sum, s) =>
          sum + this.hands[s].reduce((acc, c) => acc + cardPoints(c.card), 0),
        0,
      );
    this.scores[winner] += points;
    this.lastRound = { winner, points };
    this.exposed = null;
    this.drawnId = null;
    const reached =
      this.rules.target === 0 || this.scores[winner] >= this.rules.target;
    this.matchPhase = reached ? 'MATCH_OVER' : 'ROUND_OVER';
    if (reached) this.winnerSeat = winner;
    this.token++;
    return [
      {
        event: 'uno:round_ended',
        payload: { winner, points, scores: [...this.scores] },
      },
    ];
  }

  /** An exposed player stays catchable only until somebody else acts. */
  private closeExposure(actor: number): void {
    if (this.exposed !== null && this.exposed !== actor) this.exposed = null;
  }

  private skipped(seat: number): Announcement {
    return { event: 'uno:turn_skipped', payload: { seat } };
  }

  private directionChanged(): Announcement {
    return {
      event: 'uno:direction_changed',
      payload: { direction: this.direction },
    };
  }

  /** The seat `steps` places away along the play direction. */
  private next(from: number, steps = 1): number {
    const n = this.active.length;
    const i = this.active.indexOf(from);
    return this.active[(((i + steps * this.direction) % n) + n) % n];
  }

  private nextInSeatOrder(seat: number): number {
    return this.active.find((s) => s > seat) ?? this.active[0];
  }

  private assertPlaying(): void {
    if (this.matchPhase !== 'PLAYING')
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private assertSeated(seat: number): void {
    this.assertPlaying();
    if (!this.active.includes(seat))
      throw new DomainError('INVALID_STATE', 'Você não está na partida');
  }

  private assertTurn(seat: number): void {
    this.assertSeated(seat);
    if (seat !== this.turnSeat)
      throw new DomainError('NOT_YOUR_TURN', 'Não é a sua vez');
  }
}
