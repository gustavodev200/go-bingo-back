import {
  BJ_BET_SECONDS,
  BJ_DEALER_CARD_MS,
  BJ_INSURANCE_SECONDS,
  BJ_MAX_BET,
  BJ_MAX_HANDS,
  BJ_MIN_BET,
  BJ_BET_STEP,
  BJ_RESHUFFLE_AT,
  BJ_SETTLE_PAUSE_MS,
  BJ_START_CHIPS,
  bjBlackjackProfit,
  bjCardValue,
  bjRank,
  bjSurrenderAllowed,
  bjTotal,
  isBlackjack,
  type BjAction,
  type BjCard,
  type BjEndReason,
  type BjGameView,
  type BjHandStatus,
  type BjMatchResult,
  type BjOutcome,
  type BjPlayerView,
  type BjRules,
  type BjServerEventPayloads,
  type BjStage,
  type BjStanding,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';
import { Shoe } from './shoe';

type AnnouncedEvent = {
  [E in keyof BjServerEventPayloads]: BjServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof BjServerEventPayloads];

/** Something that happened in the match; the room adds the sequence number and broadcasts it. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<BjServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

export type BjMatchPhase = 'PLAYING' | 'OVER';

interface Hand {
  cards: BjCard[];
  bet: number;
  status: BjHandStatus;
  split: boolean;
  outcome: BjOutcome | null;
  net: number;
}

interface Player {
  seat: number;
  chips: number;
  bet: number | null;
  hands: Hand[];
  insurance: number | null;
  insuranceNet: number;
  broke: boolean;
  left: boolean;
  roundNet: number;
}

const TEN_VALUE = new Set(['T', 'J', 'Q', 'K']);

const invalid = (message: string) => new DomainError('INVALID_MOVE', message);

/**
 * A blackjack tournament: every seat starts with the same chips and plays
 * `rules.rounds` rounds against the dealer; whoever ends with more chips
 * places higher. Pure game logic: no transport, no clock. Every mutating
 * method validates, throws a DomainError when the action is not allowed and
 * returns what happened. `token` changes whenever the stage timer must restart
 * (`stageMs` says for how long).
 *
 * House rules: dealer gets a hole card and peeks with an Ace or a ten up,
 * stands on all 17s; split once (aces get one card each, 21 after a split is
 * not a blackjack); double on any first two cards (also after splitting);
 * insurance (half the bet, pays 2:1) when the dealer shows an Ace; late
 * surrender (half back) only with the 6-deck shoe.
 */
export class BjMatch {
  private readonly shoe: Shoe;
  private readonly players: Player[];
  private dealer: BjCard[] = [];
  private holeShown = false;
  private dealerDrew = 0;
  private roundNo = 0;
  private stageNow: BjStage = 'BETTING';
  private turnAt: { seat: number; hand: number } | null = null;
  private matchPhase: BjMatchPhase = 'PLAYING';
  private outcome: BjMatchResult | null = null;
  private token = 0;
  private out: Announcement[] = [];
  /** Started with two or more players: down to one, the match ends. */
  private readonly multiplayer: boolean;

  /**
   * @param seats the seats taking part (any order; they play in seat order).
   * @param stack tests: cards dealt first, in order.
   */
  constructor(
    random: RandomInt,
    seats: readonly number[],
    private readonly rules: BjRules,
    private readonly nicknameOf: (seat: number) => string,
    private readonly userIdOf: (seat: number) => string,
    stack: readonly BjCard[] = [],
  ) {
    this.shoe = new Shoe(rules.decks, random, stack);
    this.players = [...seats]
      .sort((a, b) => a - b)
      .map((seat) => ({
        seat,
        chips: BJ_START_CHIPS,
        bet: null,
        hands: [],
        insurance: null,
        insuranceNet: 0,
        broke: false,
        left: false,
        roundNet: 0,
      }));
    this.multiplayer = seats.length >= 2;
    this.startRound(false);
    this.out = [];
  }

  get phase(): BjMatchPhase {
    return this.matchPhase;
  }

  get result(): BjMatchResult | null {
    return this.outcome;
  }

  get stage(): BjStage {
    return this.stageNow;
  }

  get round(): number {
    return this.roundNo;
  }

  get turnToken(): number {
    return this.token;
  }

  /** How long the current stage lasts before `timeout()` moves it on. */
  get stageMs(): number {
    switch (this.stageNow) {
      case 'BETTING':
        return BJ_BET_SECONDS * 1000;
      case 'INSURANCE':
        return BJ_INSURANCE_SECONDS * 1000;
      case 'PLAYING':
        return this.rules.turnSeconds * 1000;
      case 'SETTLED':
        return BJ_SETTLE_PAUSE_MS + this.dealerDrew * BJ_DEALER_CARD_MS;
    }
  }

  publicView(): Omit<BjGameView, 'deadline'> {
    const shown = this.holeShown ? this.dealer : this.dealer.slice(0, 1);
    const { total, soft } = bjTotal(shown);
    const turn = this.turnAt;
    return {
      round: this.roundNo,
      stage: this.stageNow,
      dealer: {
        cards: this.holeShown
          ? [...this.dealer]
          : this.dealer.map((c, i) => (i === 1 ? null : c)),
        total,
        soft,
        blackjack: this.holeShown && isBlackjack(this.dealer),
      },
      players: this.viewSeats(),
      turn: turn ? { ...turn } : null,
      actions:
        turn && this.matchPhase === 'PLAYING'
          ? this.actionsFor(this.player(turn.seat)!, turn.hand)
          : [],
      shoeLeft: this.shoe.left,
      shoeSize: this.shoe.size,
    };
  }

  /** Places this round's bet. The deal starts as soon as everybody has bet. */
  bet(seat: number, amount: number): Announcement[] {
    this.out = [];
    this.requireStage('BETTING');
    const p = this.requireActive(seat);
    if (p.bet !== null) throw invalid('Você já apostou nesta rodada');
    if (
      amount < BJ_MIN_BET ||
      amount > BJ_MAX_BET ||
      amount % BJ_BET_STEP !== 0
    )
      throw invalid(`Aposte de ${BJ_MIN_BET} a ${BJ_MAX_BET} fichas`);
    if (amount > p.chips) throw invalid('Você não tem fichas para essa aposta');
    this.placeBet(p, amount);
    if (this.active().every((x) => x.bet !== null)) this.deal();
    return this.out;
  }

  /** Answers the insurance offer (dealer shows an Ace). */
  insurance(seat: number, take: boolean): Announcement[] {
    this.out = [];
    this.requireStage('INSURANCE');
    const p = this.requireActive(seat);
    if (p.insurance !== null) throw invalid('Você já respondeu o seguro');
    const cost = p.bet! / 2;
    if (take && p.chips < cost)
      throw invalid('Você não tem fichas para o seguro');
    p.insurance = take ? cost : 0;
    p.chips -= p.insurance;
    if (this.active().every((x) => x.insurance !== null)) this.peek();
    return this.out;
  }

  /** Hit, stand, double, split or surrender on the hand whose turn it is. */
  act(seat: number, action: BjAction): Announcement[] {
    this.out = [];
    this.requireStage('PLAYING');
    const turn = this.turnAt;
    if (!turn || turn.seat !== seat)
      throw new DomainError('NOT_YOUR_TURN', 'Não é a sua vez');
    const p = this.player(seat)!;
    if (!this.actionsFor(p, turn.hand).includes(action))
      throw invalid('Essa jogada não vale agora');
    this.apply(p, turn.hand, action, false);
    return this.out;
  }

  /**
   * The stage clock ran out: missing bets go in at the minimum, missing
   * insurance answers are "no", the hand on turn stands, and the pause after
   * a round moves to the next one (or ends the match).
   */
  timeout(): Announcement[] {
    this.out = [];
    if (this.matchPhase === 'OVER') return this.out;
    switch (this.stageNow) {
      case 'BETTING':
        for (const p of this.active())
          if (p.bet === null) this.placeBet(p, BJ_MIN_BET);
        this.deal();
        break;
      case 'INSURANCE':
        for (const p of this.active())
          if (p.insurance === null) p.insurance = 0;
        this.peek();
        break;
      case 'PLAYING': {
        const turn = this.turnAt!;
        this.apply(this.player(turn.seat)!, turn.hand, 'stand', true);
        break;
      }
      case 'SETTLED':
        this.nextRound();
        break;
    }
    return this.out;
  }

  /** The player left (or did not come back): their bets are lost and the table moves on. */
  removePlayer(seat: number): Announcement[] {
    this.out = [];
    const p = this.player(seat);
    if (!p || p.left || this.matchPhase === 'OVER') return this.out;
    p.left = true;
    for (const h of p.hands)
      if (h.status === 'playing') h.status = 'surrendered';
    const stayed = this.players.filter((x) => !x.left);
    if (stayed.length === 0 || (this.multiplayer && stayed.length === 1)) {
      this.finish('abandoned');
      return this.out;
    }
    if (this.active().length === 0) {
      this.finish('broke');
      return this.out;
    }
    if (this.stageNow === 'BETTING') {
      if (this.active().every((x) => x.bet !== null)) this.deal();
    } else if (this.stageNow === 'INSURANCE') {
      if (this.active().every((x) => x.insurance !== null)) this.peek();
    } else if (this.stageNow === 'PLAYING' && this.turnAt?.seat === seat) {
      this.nextTurn();
    }
    return this.out;
  }

  // -------------------------------------------------------------------------

  private startRound(announce = true): void {
    this.roundNo++;
    this.stageNow = 'BETTING';
    this.dealer = [];
    this.holeShown = false;
    this.dealerDrew = 0;
    this.turnAt = null;
    for (const p of this.players) {
      p.bet = null;
      p.hands = [];
      p.insurance = null;
      p.insuranceNet = 0;
      p.roundNet = 0;
    }
    // Cut card: a fresh shoe between rounds once most of it has been dealt.
    if (this.roundNo > 1 && this.shoe.left < this.shoe.size * BJ_RESHUFFLE_AT) {
      this.shoe.refill([]);
      this.announce({ event: 'blackjack:shuffled', payload: {} });
    }
    this.token++;
    if (announce)
      this.announce({
        event: 'blackjack:round_started',
        payload: { round: this.roundNo },
      });
  }

  private placeBet(p: Player, amount: number): void {
    p.bet = amount;
    p.chips -= amount;
  }

  /** Two cards to everybody, the dealer's second face down. */
  private deal(): void {
    const seated = this.active();
    for (const p of seated)
      p.hands = [
        {
          cards: [],
          bet: p.bet!,
          status: 'playing',
          split: false,
          outcome: null,
          net: 0,
        },
      ];
    for (let pass = 0; pass < 2; pass++) {
      for (const p of seated) p.hands[0].cards.push(this.draw());
      this.dealer.push(this.draw());
    }
    for (const p of seated)
      if (isBlackjack(p.hands[0].cards)) p.hands[0].status = 'blackjack';
    const aceUp = bjRank(this.dealer[0]) === 'A';
    this.announce({
      event: 'blackjack:dealt',
      payload: {
        insurance: aceUp,
        blackjacks: seated
          .filter((p) => p.hands[0].status === 'blackjack')
          .map((p) => p.seat),
      },
    });
    if (aceUp) {
      this.stageNow = 'INSURANCE';
      this.token++;
      // Nobody can buy insurance without the chips for it.
      for (const p of seated) if (p.chips < p.bet! / 2) p.insurance = 0;
      if (seated.every((p) => p.insurance !== null)) this.peek();
      return;
    }
    this.peek();
  }

  /** With an Ace or a ten up the dealer checks for blackjack before anyone plays. */
  private peek(): void {
    const up = bjRank(this.dealer[0]);
    if ((up === 'A' || TEN_VALUE.has(up)) && isBlackjack(this.dealer)) {
      this.dealerPlay();
      return;
    }
    this.stageNow = 'PLAYING';
    this.nextTurn();
  }

  private apply(p: Player, index: number, action: BjAction, auto: boolean) {
    const hand = p.hands[index];
    switch (action) {
      case 'hit':
        hand.cards.push(this.draw());
        this.settleTotal(hand);
        break;
      case 'stand':
        hand.status = 'stood';
        break;
      case 'double':
        p.chips -= hand.bet;
        hand.bet *= 2;
        hand.cards.push(this.draw());
        hand.status = bjTotal(hand.cards).total > 21 ? 'bust' : 'doubled';
        break;
      case 'split': {
        p.chips -= hand.bet;
        const second: Hand = {
          cards: [hand.cards.pop()!],
          bet: hand.bet,
          status: 'playing',
          split: true,
          outcome: null,
          net: 0,
        };
        hand.split = true;
        p.hands.push(second);
        const aces = bjRank(hand.cards[0]) === 'A';
        for (const h of p.hands) {
          h.cards.push(this.draw());
          // Split aces get one card each and stop there.
          if (aces) h.status = 'stood';
          else this.settleTotal(h);
        }
        break;
      }
      case 'surrender':
        hand.status = 'surrendered';
        break;
    }
    this.announce({
      event: 'blackjack:acted',
      payload: {
        seat: p.seat,
        hand: index,
        action,
        status: hand.status,
        total: bjTotal(hand.cards).total,
        auto,
      },
    });
    this.nextTurn();
  }

  /** After a card: over 21 busts, exactly 21 stops by itself. */
  private settleTotal(hand: Hand): void {
    const { total } = bjTotal(hand.cards);
    if (total > 21) hand.status = 'bust';
    else if (total === 21) hand.status = 'stood';
  }

  private actionsFor(p: Player, index: number): BjAction[] {
    const hand = p.hands[index];
    if (!hand || hand.status !== 'playing' || p.left) return [];
    const actions: BjAction[] = ['hit', 'stand'];
    const firstTwo = hand.cards.length === 2;
    if (firstTwo && p.chips >= hand.bet) actions.push('double');
    if (
      firstTwo &&
      p.hands.length < BJ_MAX_HANDS &&
      bjCardValue(hand.cards[0]) === bjCardValue(hand.cards[1]) &&
      p.chips >= hand.bet
    )
      actions.push('split');
    if (
      firstTwo &&
      !hand.split &&
      p.hands.length === 1 &&
      bjSurrenderAllowed(this.rules)
    )
      actions.push('surrender');
    return actions;
  }

  /** Moves the turn to the next hand still playing, or lets the dealer play. */
  private nextTurn(): void {
    for (const p of this.active()) {
      const hand = p.hands.findIndex((h) => h.status === 'playing');
      if (hand >= 0) {
        this.turnAt = { seat: p.seat, hand };
        this.token++;
        return;
      }
    }
    this.turnAt = null;
    this.dealerPlay();
  }

  /** Turns the hole card and draws to 17 (stands on soft 17) if any hand is still alive. */
  private dealerPlay(): void {
    this.holeShown = true;
    const before = this.dealer.length;
    const alive = this.active().some((p) =>
      p.hands.some((h) => h.status === 'stood' || h.status === 'doubled'),
    );
    if (alive && !isBlackjack(this.dealer))
      while (bjTotal(this.dealer).total < 17) this.dealer.push(this.draw());
    this.dealerDrew = this.dealer.length - before;
    const { total } = bjTotal(this.dealer);
    this.announce({
      event: 'blackjack:dealer_played',
      payload: {
        total,
        blackjack: isBlackjack(this.dealer),
        bust: total > 21,
        drew: this.dealerDrew,
      },
    });
    this.settleRound();
  }

  private settleRound(): void {
    const dealerBj = isBlackjack(this.dealer);
    const dealerTotal = bjTotal(this.dealer).total;
    const nets: { seat: number; net: number }[] = [];
    for (const p of this.players) {
      if (p.bet === null) continue;
      let net = 0;
      for (const h of p.hands) {
        const back = this.handReturn(h, dealerBj, dealerTotal, p.left);
        h.net = back - h.bet;
        p.chips += back;
        net += h.net;
      }
      if (p.insurance) {
        if (dealerBj) {
          p.insuranceNet = p.insurance * 2;
          p.chips += p.insurance * 3;
        } else p.insuranceNet = -p.insurance;
        net += p.insuranceNet;
      }
      p.roundNet = net;
      nets.push({ seat: p.seat, net });
    }
    this.stageNow = 'SETTLED';
    this.token++;
    this.announce({
      event: 'blackjack:round_settled',
      payload: { round: this.roundNo, nets },
    });
  }

  /** What a hand gives back (bet included) once the dealer is done. */
  private handReturn(
    h: Hand,
    dealerBj: boolean,
    dealerTotal: number,
    left: boolean,
  ): number {
    const total = bjTotal(h.cards).total;
    const win = (o: BjOutcome, back: number) => {
      h.outcome = o;
      return back;
    };
    if (left) return win('lose', 0);
    if (h.status === 'surrendered') return win('surrender', h.bet / 2);
    if (h.status === 'bust') return win('lose', 0);
    if (h.status === 'blackjack')
      return dealerBj
        ? win('push', h.bet)
        : win('blackjack', h.bet + bjBlackjackProfit(h.bet, this.rules.payout));
    if (dealerBj) return win('lose', 0);
    if (dealerTotal > 21 || total > dealerTotal) return win('win', h.bet * 2);
    if (total === dealerTotal) return win('push', h.bet);
    return win('lose', 0);
  }

  private nextRound(): void {
    for (const p of this.players)
      if (!p.left && !p.broke && p.chips < BJ_MIN_BET) {
        p.broke = true;
        this.announce({
          event: 'blackjack:player_broke',
          payload: { seat: p.seat },
        });
      }
    if (this.active().length === 0) return this.finish('broke');
    if (this.roundNo >= this.rules.rounds) return this.finish('rounds');
    this.startRound();
  }

  private finish(reason: BjEndReason): void {
    // Ended mid-round (everybody else left): what is still on the table goes back.
    if (this.stageNow !== 'SETTLED')
      for (const p of this.players)
        if (!p.left) {
          p.chips += p.hands.reduce((sum, h) => sum + h.bet, 0);
          if (p.hands.length === 0 && p.bet !== null) p.chips += p.bet;
          p.chips += p.insurance ?? 0;
          p.bet = null;
          p.insurance = null;
        }
    this.matchPhase = 'OVER';
    this.turnAt = null;
    this.token++;
    this.outcome = { reason, standings: this.standings() };
    this.announce({ event: 'blackjack:match_over', payload: this.outcome });
  }

  private standings(): BjStanding[] {
    const stayed = this.players.filter((p) => !p.left);
    const worst = stayed.length + 1;
    return this.players
      .map((p) => ({
        seat: p.seat,
        userId: this.userIdOf(p.seat),
        nickname: this.nicknameOf(p.seat),
        chips: p.chips,
        placement: p.left
          ? worst
          : 1 + stayed.filter((o) => o.chips > p.chips).length,
        left: p.left,
      }))
      .sort((a, b) => a.placement - b.placement || a.seat - b.seat);
  }

  private draw(): BjCard {
    const { card, shuffled } = this.shoe.draw(() => this.inPlay());
    if (shuffled) this.announce({ event: 'blackjack:shuffled', payload: {} });
    return card;
  }

  private inPlay(): BjCard[] {
    return [
      ...this.dealer,
      ...this.players.flatMap((p) => p.hands.flatMap((h) => h.cards)),
    ];
  }

  private viewSeats(): (BjPlayerView | null)[] {
    const max = Math.max(...this.players.map((p) => p.seat));
    const out: (BjPlayerView | null)[] = Array.from(
      { length: max + 1 },
      () => null,
    );
    for (const p of this.players)
      out[p.seat] = {
        seat: p.seat,
        chips: p.chips,
        bet: p.bet,
        hands: p.hands.map((h) => {
          const { total, soft } = bjTotal(h.cards);
          return {
            cards: [...h.cards],
            bet: h.bet,
            total,
            soft,
            status: h.status,
            split: h.split,
            outcome: h.outcome,
            net: h.net,
          };
        }),
        insurance: p.insurance,
        insuranceNet: p.insuranceNet,
        broke: p.broke,
        left: p.left,
        roundNet: p.roundNet,
      };
    return out;
  }

  private active(): Player[] {
    return this.players.filter((p) => !p.left && !p.broke);
  }

  private player(seat: number): Player | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  private requireActive(seat: number): Player {
    const p = this.player(seat);
    if (!p || p.left) throw invalid('Você não está nesta partida');
    if (p.broke) throw invalid('Você ficou sem fichas nesta partida');
    return p;
  }

  private requireStage(stage: BjStage): void {
    if (this.matchPhase !== 'PLAYING' || this.stageNow !== stage)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private announce(a: Announcement): void {
    this.out.push(a);
  }
}
