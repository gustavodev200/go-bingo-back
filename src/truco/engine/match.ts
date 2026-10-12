import {
  partnerOf,
  teamOf,
  TRUCO_BET_LADDER,
  TRUCO_IRON_HAND_VALUE,
  TRUCO_TARGET_SCORE,
  TRUCO_TEN_HAND_RUN_POINTS,
  TRUCO_TEN_HAND_VALUE,
  TRUCO_TEN_THRESHOLD,
  type Seat,
  type Team,
  type TrucoBetResponse,
  type TrucoCard,
  type TrucoHandEndReason,
  type TrucoHandKind,
  type TrucoHandPhase,
  type TrucoHandResult,
  type TrucoMatchView,
  type TrucoPendingBet,
  type TrucoPlay,
  type TrucoPrivateHand,
  type TrucoServerEventPayloads,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';
import { cardStrength, newDeck, shuffle } from './cards';

type AnnouncedEvent = {
  [E in keyof TrucoServerEventPayloads]: TrucoServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof TrucoServerEventPayloads];

/** Something that happened in the match; the room adds the sequence number and broadcasts it. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<TrucoServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

interface DealtCard {
  id: string;
  card: TrucoCard;
}

interface Round {
  plays: TrucoPlay[];
  result: Team | 'tie' | null;
  winningSeat: Seat | null;
}

interface Hand {
  number: number;
  kind: TrucoHandKind;
  tenTeam: Team | null;
  phase: TrucoHandPhase;
  cards: DealtCard[][];
  value: number;
  pendingBet: (TrucoPendingBet & { previous: number }) | null;
  lastRaiseTeam: Team | null;
  turn: Seat;
  rounds: Round[];
  result: TrucoHandResult | null;
}

const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
const otherTeam = (team: Team): Team => (1 - team) as Team;

function nextBetValue(value: number): number | null {
  const i = TRUCO_BET_LADDER.indexOf(
    value as (typeof TRUCO_BET_LADDER)[number],
  );
  return i >= 0 && i < TRUCO_BET_LADDER.length - 1
    ? TRUCO_BET_LADDER[i + 1]
    : null;
}

/**
 * Who wins the hand given the round results so far, or undefined to keep playing.
 * - two round wins win the hand;
 * - once a round is tied, the first decided round wins (tie 1st → 2nd decides;
 *   win 1st and tie 2nd or 3rd → 1st winner keeps it);
 * - three tied rounds void the hand (nobody scores).
 */
export function handWinner(
  results: readonly (Team | 'tie')[],
): Team | 'void' | undefined {
  for (const team of [0, 1] as const)
    if (results.filter((r) => r === team).length >= 2) return team;
  const decided = results.filter((r): r is Team => r !== 'tie');
  if (results.length >= 2 && results.includes('tie') && decided.length > 0)
    return decided[0];
  if (results.length === 3) return 'void';
  return undefined;
}

/**
 * Truco Mineiro rules for one match (first team to 12 tentos).
 * Pure game logic: no transport, no timers. Every mutating method validates
 * the move, throws a DomainError when it is not allowed and returns what happened.
 */
export class TrucoMatch {
  readonly scores: [number, number];
  private winnerTeam: Team | null = null;
  private dealer: Seat;
  private handCount = 0;
  private hand: Hand | null = null;
  private readonly deckSource: () => TrucoCard[];

  constructor(
    private readonly random: RandomInt,
    init: {
      dealer?: Seat;
      scores?: [number, number];
      /** Test hook: the 12 first cards are dealt 3 per seat (seat 0 first). */
      deck?: () => TrucoCard[];
    } = {},
  ) {
    this.deckSource = init.deck ?? (() => shuffle(newDeck(), this.random));
    this.dealer = init.dealer ?? (random(0, 4) as Seat);
    this.scores = init.scores ? [...init.scores] : [0, 0];
  }

  get winner(): Team | null {
    return this.winnerTeam;
  }

  get phase(): TrucoHandPhase {
    return this.hand?.phase ?? 'DEALING';
  }

  /** Deals the next hand (the first one keeps the initial dealer, then it rotates). */
  deal(): Announcement[] {
    if (this.winnerTeam !== null)
      throw new DomainError('INVALID_STATE', 'A partida já terminou');
    if (this.hand && this.hand.phase !== 'HAND_OVER')
      throw new DomainError('INVALID_STATE', 'A mão ainda está em andamento');
    if (this.hand) this.dealer = nextSeat(this.dealer);
    this.handCount++;

    const deck = this.deckSource();
    const number = this.handCount;
    const cards = [0, 1, 2, 3].map((seat) =>
      deck
        .slice(seat * 3, seat * 3 + 3)
        .map((card, i) => ({ id: `h${number}s${seat}c${i}`, card })),
    );

    const [a, b] = this.scores;
    let kind: TrucoHandKind = 'normal';
    let tenTeam: Team | null = null;
    if (a >= TRUCO_TEN_THRESHOLD && b >= TRUCO_TEN_THRESHOLD) kind = 'iron';
    else if (a >= TRUCO_TEN_THRESHOLD || b >= TRUCO_TEN_THRESHOLD) {
      kind = 'ten';
      tenTeam = a >= TRUCO_TEN_THRESHOLD ? 0 : 1;
    }

    const starter = nextSeat(this.dealer);
    this.hand = {
      number,
      kind,
      tenTeam,
      phase: kind === 'ten' ? 'AWAITING_TEN_DECISION' : 'AWAITING_PLAY',
      cards,
      value:
        kind === 'ten'
          ? TRUCO_TEN_HAND_VALUE
          : kind === 'iron'
            ? TRUCO_IRON_HAND_VALUE
            : TRUCO_BET_LADDER[0],
      pendingBet: null,
      lastRaiseTeam: null,
      turn: starter,
      rounds: [{ plays: [], result: null, winningSeat: null }],
      result: null,
    };
    return [
      {
        event: 'truco:hand_dealt',
        payload: { handNumber: number, kind, tenTeam },
      },
    ];
  }

  play(seat: Seat, cardId: string): Announcement[] {
    const hand = this.requireHand();
    if (hand.phase === 'AWAITING_BET_RESPONSE')
      throw new DomainError('INVALID_STATE', 'Aguardando resposta da aposta');
    this.requirePhase(hand, 'AWAITING_PLAY');
    if (hand.turn !== seat)
      throw new DomainError('NOT_YOUR_TURN', 'Não é a sua vez');
    const mine = hand.cards[seat];
    const index = mine.findIndex((c) => c.id === cardId);
    if (index < 0)
      throw new DomainError('INVALID_MOVE', 'Essa carta não está na sua mão');
    const [{ card }] = mine.splice(index, 1);

    const round = hand.rounds[hand.rounds.length - 1];
    round.plays.push({ seat, card });
    const out: Announcement[] = [
      {
        event: 'truco:card_played',
        payload: { seat, card, round: hand.rounds.length },
      },
    ];
    if (round.plays.length < 4) {
      hand.turn = nextSeat(seat);
      return out;
    }
    return [...out, ...this.closeRound(hand, round)];
  }

  requestBet(seat: Seat): Announcement[] {
    const hand = this.requireHand();
    this.requirePhase(hand, 'AWAITING_PLAY');
    if (hand.kind !== 'normal')
      throw new DomainError(
        'INVALID_MOVE',
        hand.kind === 'ten'
          ? 'Não se pede truco na mão de dez'
          : 'Não se pede truco na mão de ferro',
      );
    if (hand.turn !== seat)
      throw new DomainError('NOT_YOUR_TURN', 'Peça truco na sua vez');
    const team = teamOf(seat);
    if (hand.lastRaiseTeam === team)
      throw new DomainError(
        'INVALID_MOVE',
        'Sua dupla já aumentou; agora só o adversário pode aumentar',
      );
    const value = nextBetValue(hand.value);
    if (value === null)
      throw new DomainError('INVALID_MOVE', 'A mão já vale o máximo');
    hand.pendingBet = { value, requestedBy: seat, team, previous: hand.value };
    hand.phase = 'AWAITING_BET_RESPONSE';
    return [{ event: 'truco:bet_requested', payload: { seat, team, value } }];
  }

  respondBet(seat: Seat, response: TrucoBetResponse): Announcement[] {
    const hand = this.requireHand();
    this.requirePhase(hand, 'AWAITING_BET_RESPONSE');
    const bet = hand.pendingBet!;
    const team = teamOf(seat);
    if (team === bet.team)
      throw new DomainError(
        'INVALID_MOVE',
        'Quem responde a aposta é a dupla adversária',
      );

    if (response === 'run') {
      return [
        {
          event: 'truco:bet_resolved',
          payload: { seat, response: 'run', value: bet.previous },
        },
        ...this.endHand(hand, bet.team, bet.previous, 'bet_declined'),
      ];
    }

    const raised = response === 'raise' ? nextBetValue(bet.value) : null;
    if (response === 'raise' && raised === null)
      throw new DomainError('INVALID_MOVE', 'A mão já vale o máximo');
    // Raising implies accepting the pending value first.
    hand.value = bet.value;
    hand.lastRaiseTeam = bet.team;
    if (raised === null) {
      hand.pendingBet = null;
      hand.phase = 'AWAITING_PLAY';
      return [
        {
          event: 'truco:bet_resolved',
          payload: { seat, response: 'accept', value: bet.value },
        },
      ];
    }
    const value = raised;
    hand.pendingBet = { value, requestedBy: seat, team, previous: bet.value };
    return [{ event: 'truco:bet_requested', payload: { seat, team, value } }];
  }

  decideTen(seat: Seat, play: boolean): Announcement[] {
    const hand = this.requireHand();
    this.requirePhase(hand, 'AWAITING_TEN_DECISION');
    if (teamOf(seat) !== hand.tenTeam)
      throw new DomainError(
        'INVALID_MOVE',
        'Só a dupla com 10 tentos decide a mão de dez',
      );
    const decided: Announcement = {
      event: 'truco:ten_decided',
      payload: { seat, play },
    };
    if (play) {
      hand.phase = 'AWAITING_PLAY';
      return [decided];
    }
    return [
      decided,
      ...this.endHand(
        hand,
        otherTeam(hand.tenTeam),
        TRUCO_TEN_HAND_RUN_POINTS,
        'ten_declined',
      ),
    ];
  }

  /** A player left for good: the other team wins by walkover. */
  abandon(leavingTeam: Team): Announcement[] {
    if (this.winnerTeam !== null) return [];
    this.winnerTeam = otherTeam(leavingTeam);
    if (this.hand) {
      this.hand.phase = 'HAND_OVER';
      this.hand.pendingBet = null;
    }
    return [
      {
        event: 'truco:match_over',
        payload: {
          winnerTeam: this.winnerTeam,
          reason: 'abandoned',
          scores: [...this.scores],
        },
      },
    ];
  }

  publicView(): TrucoMatchView | null {
    const hand = this.hand;
    if (!hand) return null;
    return {
      handNumber: hand.number,
      dealer: this.dealer,
      phase: hand.phase,
      kind: hand.kind,
      tenTeam: hand.tenTeam,
      value: hand.value,
      pendingBet: hand.pendingBet && {
        value: hand.pendingBet.value,
        requestedBy: hand.pendingBet.requestedBy,
        team: hand.pendingBet.team,
      },
      lastRaiseTeam: hand.lastRaiseTeam,
      turn: hand.turn,
      rounds: hand.rounds.map((r) => ({
        plays: r.plays.map((p) => ({ seat: p.seat, card: { ...p.card } })),
        result: r.result,
        winningSeat: r.winningSeat,
      })),
      cardsLeft: hand.cards.map((c) => c.length) as [
        number,
        number,
        number,
        number,
      ],
      lastHandResult: hand.result,
    };
  }

  /** What only `seat` may see: its own cards (blind in the mão de ferro) and, deciding a mão de dez, the partner's. */
  privateView(seat: Seat): TrucoPrivateHand | null {
    const hand = this.hand;
    if (!hand) return null;
    const blind = hand.kind === 'iron';
    const showPartner =
      hand.phase === 'AWAITING_TEN_DECISION' && teamOf(seat) === hand.tenTeam;
    return {
      handNumber: hand.number,
      cards: hand.cards[seat].map((c) => ({
        id: c.id,
        card: blind ? null : { ...c.card },
      })),
      partnerCards: showPartner
        ? hand.cards[partnerOf(seat)].map((c) => ({ ...c.card }))
        : null,
    };
  }

  private closeRound(hand: Hand, round: Round): Announcement[] {
    const best = Math.max(...round.plays.map((p) => cardStrength(p.card)));
    const top = round.plays.filter((p) => cardStrength(p.card) === best);
    const teams = new Set(top.map((p) => teamOf(p.seat)));
    round.winningSeat = top[0].seat;
    round.result = teams.size === 1 ? teamOf(top[0].seat) : 'tie';
    const out: Announcement[] = [
      {
        event: 'truco:round_ended',
        payload: {
          round: hand.rounds.length,
          result: round.result,
          winningSeat: round.winningSeat,
        },
      },
    ];
    const decided = handWinner(
      hand.rounds.map((r) => r.result as Team | 'tie'),
    );
    if (decided === undefined) {
      hand.rounds.push({ plays: [], result: null, winningSeat: null });
      // The round winner (or whoever first played the tying card) starts the next one.
      hand.turn = round.winningSeat;
      return out;
    }
    return decided === 'void'
      ? [...out, ...this.endHand(hand, null, 0, 'void')]
      : [...out, ...this.endHand(hand, decided, hand.value, 'rounds')];
  }

  private endHand(
    hand: Hand,
    winner: Team | null,
    points: number,
    reason: TrucoHandEndReason,
  ): Announcement[] {
    hand.phase = 'HAND_OVER';
    hand.pendingBet = null;
    hand.result = { winnerTeam: winner, points, reason };
    if (winner !== null)
      this.scores[winner] = Math.min(
        TRUCO_TARGET_SCORE,
        this.scores[winner] + points,
      );
    const out: Announcement[] = [
      { event: 'truco:hand_ended', payload: { ...hand.result } },
      { event: 'truco:score_updated', payload: { scores: [...this.scores] } },
    ];
    if (winner !== null && this.scores[winner] >= TRUCO_TARGET_SCORE) {
      this.winnerTeam = winner;
      out.push({
        event: 'truco:match_over',
        payload: {
          winnerTeam: winner,
          reason: 'points',
          scores: [...this.scores],
        },
      });
    }
    return out;
  }

  private requireHand(): Hand {
    if (!this.hand || this.winnerTeam !== null)
      throw new DomainError('INVALID_STATE', 'Nenhuma mão em andamento');
    return this.hand;
  }

  private requirePhase(hand: Hand, phase: TrucoHandPhase): void {
    if (hand.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação fora de hora');
  }
}
