import {
  envidoBest,
  envidoPoints,
  faltaPoints,
  florPoints,
  GAUD_CALLS,
  GAUD_CONTRAFLOR_POINTS,
  GAUD_ENVIDO_VALUE,
  GAUD_FLOR_DECLINED_POINTS,
  GAUD_FLOR_POINTS,
  GAUD_RANKS,
  GAUD_SUITS,
  GAUD_TRUCO_VALUE,
  gaudCallKind,
  gaudStrength,
  gaudTeamOf,
  hasFlor,
  type GaudActions,
  type GaudCall,
  type GaudCard,
  type GaudHandEndReason,
  type GaudHandPhase,
  type GaudHandResult,
  type GaudMatchView,
  type GaudPending,
  type GaudPrivateHand,
  type GaudSeat,
  type GaudServerEventPayloads,
  type GaudSettings,
  type GaudSideResult,
  type GaudTeam,
  type GaudFinish,
  type GaudVote,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import type { RandomInt } from '../../core/random';

type AnnouncedEvent = {
  [E in keyof GaudServerEventPayloads]: GaudServerEventPayloads[E] extends {
    seq: number;
  }
    ? E
    : never;
}[keyof GaudServerEventPayloads];

/** Algo que aconteceu na partida; a sala numera (seq) e transmite. */
export type Announcement = {
  [E in AnnouncedEvent]: {
    event: E;
    payload: Omit<GaudServerEventPayloads[E], 'seq'>;
  };
}[AnnouncedEvent];

interface DealtCard {
  id: string;
  card: GaudCard;
}

interface Play {
  seat: GaudSeat;
  card: GaudCard;
  hidden: boolean;
}

interface Round {
  plays: Play[];
  result: GaudTeam | 'tie' | null;
  winningSeat: GaudSeat | null;
}

type PendingCall = Omit<GaudPending, 'votes'>;

interface Vote {
  seat: GaudSeat;
  choice: GaudVote;
}

/** Quanto mais ousado, mais alto: não quero < quero < aumento de truco < envido < flor. */
const boldness = (choice: GaudVote) =>
  choice === 'decline'
    ? 0
    : choice === 'accept'
      ? 1
      : 2 + GAUD_CALLS.indexOf(choice);

interface Hand {
  number: number;
  mano: GaudSeat;
  phase: GaudHandPhase;
  turn: GaudSeat;
  /** As 3 cartas recebidas (envido e flor contam com elas, mesmo depois de jogadas). */
  dealt: GaudCard[][];
  cards: DealtCard[][];
  trucoValue: number;
  trucoLastRaiseTeam: GaudTeam | null;
  pending: PendingCall | null;
  trucoOnHold: PendingCall | null;
  /** Votos da dupla que responde ao canto pendente. */
  votes: Vote[];
  envidoClosed: boolean;
  florDeclared: boolean;
  /** Quem tinha flor e jogou a primeira carta sem cantar: perdeu a flor. */
  florLost: GaudSeat[];
  sideResults: GaudSideResult[];
  rounds: Round[];
  result: GaudHandResult | null;
}

const TRUCO_STEPS = ['truco', 'retruco', 'vale4'] as const;
const otherTeam = (team: GaudTeam): GaudTeam => (1 - team) as GaudTeam;

export function newDeck(): GaudCard[] {
  return GAUD_SUITS.flatMap((suit) =>
    GAUD_RANKS.map((rank) => ({ rank, suit })),
  );
}

/** Fisher–Yates com RNG injetável (crypto em produção). */
export function shuffle<T>(items: readonly T[], random: RandomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(0, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Quem ganha a mão com os resultados das rodadas até agora (undefined = segue).
 * - duas rodadas ganhas vencem;
 * - com empate, vale a primeira rodada decidida (empata a 1ª → a 2ª decide;
 *   ganha a 1ª e empata a 2ª ou a 3ª → fica com quem ganhou a 1ª);
 * - três empates: vence a dupla de quem é mão.
 */
export function handWinner(
  results: readonly (GaudTeam | 'tie')[],
  manoTeam: GaudTeam,
): GaudTeam | undefined {
  for (const team of [0, 1] as const)
    if (results.filter((r) => r === team).length >= 2) return team;
  const decided = results.filter((r): r is GaudTeam => r !== 'tie');
  if (results.length >= 2 && results.includes('tie') && decided.length > 0)
    return decided[0];
  if (results.length === 3) return decided[0] ?? manoTeam;
  return undefined;
}

/** Soma do envido (falta envido = a falta). */
function envidoChainValue(
  chain: readonly GaudCall[],
  scores: [number, number],
  target: number,
): number {
  if (chain.includes('falta_envido')) return faltaPoints(scores, target);
  return chain.reduce(
    (sum, c) =>
      sum + (GAUD_ENVIDO_VALUE[c as keyof typeof GAUD_ENVIDO_VALUE] ?? 0),
    0,
  );
}

/** Aumentos possíveis sobre uma sequência de envido. */
function envidoRaises(chain: readonly GaudCall[]): GaudCall[] {
  if (chain.includes('falta_envido')) return [];
  const out: GaudCall[] = [];
  if (chain.length === 1 && chain[0] === 'envido') out.push('envido');
  if (!chain.includes('real_envido')) out.push('real_envido');
  out.push('falta_envido');
  return out;
}

/**
 * Uma partida de Truco Gaudério (2 ou 4 jogadores). Regras puras: sem transporte
 * nem timers. Cada método valida a jogada, lança DomainError quando não pode e
 * devolve o que aconteceu.
 */
export class GaudMatch {
  readonly scores: [number, number];
  readonly settings: GaudSettings;
  private winnerTeam: GaudTeam | null = null;
  private finishInfo: GaudFinish | null = null;
  private dealer: GaudSeat;
  private handCount = 0;
  private hand: Hand | null = null;
  private readonly deckSource: () => GaudCard[];

  constructor(
    private readonly random: RandomInt,
    settings: GaudSettings,
    init: {
      dealer?: GaudSeat;
      scores?: [number, number];
      /** Gancho de teste: as primeiras cartas saem 3 por lugar (lugar 0 primeiro). */
      deck?: () => GaudCard[];
    } = {},
  ) {
    this.settings = { ...settings };
    this.deckSource = init.deck ?? (() => shuffle(newDeck(), this.random));
    this.dealer = init.dealer ?? (random(0, settings.size) as GaudSeat);
    this.scores = init.scores ? [...init.scores] : [0, 0];
  }

  get winner(): GaudTeam | null {
    return this.winnerTeam;
  }

  /** Como saiu o ponto que fechou a partida (null antes do fim ou em W.O.). */
  get finish(): GaudFinish | null {
    return this.finishInfo;
  }

  get phase(): GaudHandPhase {
    return this.hand?.phase ?? 'HAND_OVER';
  }

  private next(seat: GaudSeat): GaudSeat {
    return ((seat + 1) % this.settings.size) as GaudSeat;
  }

  /** Lugares na ordem de jogo a partir do mão. */
  private orderFrom(mano: GaudSeat): GaudSeat[] {
    const out: GaudSeat[] = [mano];
    while (out.length < this.settings.size)
      out.push(this.next(out[out.length - 1]));
    return out;
  }

  /** Dá a próxima mão (a primeira mantém quem dá; depois gira). */
  deal(): Announcement[] {
    if (this.winnerTeam !== null)
      throw new DomainError('INVALID_STATE', 'A partida já terminou');
    if (this.hand && this.hand.phase !== 'HAND_OVER')
      throw new DomainError('INVALID_STATE', 'A mão ainda está em andamento');
    if (this.hand) this.dealer = this.next(this.dealer);
    this.handCount++;
    const number = this.handCount;
    const deck = this.deckSource();
    const cards = Array.from({ length: this.settings.size }, (_, seat) =>
      deck
        .slice(seat * 3, seat * 3 + 3)
        .map((card, i) => ({ id: `h${number}s${seat}c${i}`, card })),
    );
    const mano = this.next(this.dealer);
    this.hand = {
      number,
      mano,
      phase: 'AWAITING_PLAY',
      turn: mano,
      dealt: cards.map((c) => c.map((d) => ({ ...d.card }))),
      cards,
      trucoValue: 1,
      trucoLastRaiseTeam: null,
      pending: null,
      trucoOnHold: null,
      votes: [],
      envidoClosed: false,
      florDeclared: false,
      florLost: [],
      sideResults: [],
      rounds: [{ plays: [], result: null, winningSeat: null }],
      result: null,
    };
    return [
      { event: 'gauderio:hand_dealt', payload: { handNumber: number, mano } },
    ];
  }

  // -------------------------------------------------------------------------
  // Validação (também alimenta as ações disponíveis de cada jogador)
  // -------------------------------------------------------------------------

  private playedInFirstRound(hand: Hand, seat: GaudSeat): boolean {
    return hand.rounds[0].plays.some((p) => p.seat === seat);
  }

  /** Tem flor válida: a regra está ligada e não a perdeu jogando a 1ª carta sem cantar. */
  private holdsFlor(hand: Hand, seat: GaudSeat): boolean {
    return (
      this.settings.flor &&
      hasFlor(hand.dealt[seat]) &&
      !hand.florLost.includes(seat)
    );
  }

  private florHolders(hand: Hand, team: GaudTeam): GaudSeat[] {
    return this.orderFrom(hand.mano).filter(
      (s) => gaudTeamOf(s) === team && this.holdsFlor(hand, s),
    );
  }

  /** Pode cantar flor agora (é opcional): 1ª rodada, antes de jogar, sem envido já disputado. */
  private canSingFlor(hand: Hand, seat: GaudSeat): boolean {
    return (
      !hand.florDeclared &&
      hand.rounds.length === 1 &&
      this.holdsFlor(hand, seat) &&
      !this.playedInFirstRound(hand, seat) &&
      !hand.sideResults.some((r) => r.kind === 'envido')
    );
  }

  private partnerOf(seat: GaudSeat): GaudSeat | null {
    return this.settings.size === 4 ? (((seat + 2) % 4) as GaudSeat) : null;
  }

  private active(): Hand | null {
    const hand = this.hand;
    if (!hand || this.winnerTeam !== null || hand.phase === 'HAND_OVER')
      return null;
    return hand;
  }

  private envidoStartError(hand: Hand, seat: GaudSeat): string | null {
    if (hand.envidoClosed || hand.rounds.length > 1)
      return 'O envido só vale na primeira rodada';
    if (this.playedInFirstRound(hand, seat))
      return 'Envido só antes de jogar sua carta';
    return null;
  }

  callError(seat: GaudSeat, call: GaudCall): string | null {
    const hand = this.active();
    if (!hand) return 'Nenhuma mão em andamento';
    const team = gaudTeamOf(seat);
    const kind = gaudCallKind(call);
    const pending = hand.pending;

    if (pending) {
      if (pending.team === team) return 'Espere a resposta da outra dupla';
      if (pending.kind === 'truco') {
        if (kind === 'truco') {
          const i = TRUCO_STEPS.indexOf(
            pending.call as (typeof TRUCO_STEPS)[number],
          );
          return TRUCO_STEPS[i + 1] === call ? null : 'Aumento inválido';
        }
        if (kind === 'flor')
          return call === 'flor' && this.canSingFlor(hand, seat)
            ? null
            : 'Você não tem flor para cantar';
        if (pending.call !== 'truco' || hand.trucoOnHold)
          return 'O envido só responde ao primeiro truco';
        if (
          call !== 'envido' &&
          call !== 'real_envido' &&
          call !== 'falta_envido'
        )
          return 'Canto inválido';
        return this.envidoStartError(hand, seat);
      }
      if (pending.kind === 'envido') {
        if (kind === 'flor')
          return call === 'flor' && this.canSingFlor(hand, seat)
            ? null
            : 'Você não tem flor para cantar';
        if (kind === 'truco') return 'Responda o envido primeiro';
        return envidoRaises(pending.chain).includes(call)
          ? null
          : 'Aumento de envido inválido';
      }
      // Flor contra flor: só contra-flor e contra-flor e o resto.
      if (call === 'contraflor')
        return pending.chain.length === 1 ? null : 'Aumento de flor inválido';
      if (call === 'contraflor_resto')
        return pending.chain.includes('contraflor_resto')
          ? 'Aumento de flor inválido'
          : null;
      return 'Responda a flor primeiro';
    }

    if (hand.phase !== 'AWAITING_PLAY') return 'Ação fora de hora';
    if (hand.turn !== seat) return 'Cante na sua vez';
    if (kind === 'truco') {
      const expected = TRUCO_STEPS[hand.trucoValue - 1];
      if (!expected) return 'A mão já vale o máximo';
      if (call !== expected) return 'Canto inválido';
      if (hand.trucoLastRaiseTeam === team)
        return 'Sua dupla já aumentou; agora só o adversário pode aumentar';
      return null;
    }
    if (kind === 'flor')
      return call === 'flor' && this.canSingFlor(hand, seat)
        ? null
        : 'Você não tem flor para cantar';
    if (call !== 'envido' && call !== 'real_envido' && call !== 'falta_envido')
      return 'Canto inválido';
    if (hand.trucoValue > 1) return 'Depois do truco aceito não tem envido';
    return this.envidoStartError(hand, seat);
  }

  respondError(seat: GaudSeat, accept: boolean): string | null {
    const hand = this.active();
    if (!hand) return 'Nenhuma mão em andamento';
    const pending = hand.pending;
    if (!pending) return 'Não há canto para responder';
    const team = gaudTeamOf(seat);
    if (pending.team === team) return 'Quem responde é a outra dupla';
    if (pending.kind === 'flor' && accept && pending.chain.length === 1)
      return 'Responda com contra-flor ou fuja';
    return null;
  }

  // -------------------------------------------------------------------------
  // Jogadas
  // -------------------------------------------------------------------------

  play(seat: GaudSeat, cardId: string, hidden = false): Announcement[] {
    const hand = this.requireHand();
    if (hand.phase === 'AWAITING_RESPONSE')
      throw new DomainError('INVALID_STATE', 'Responda o canto primeiro');
    if (hand.turn !== seat)
      throw new DomainError('NOT_YOUR_TURN', 'Não é a sua vez');
    if (hidden && hand.rounds.length === 1)
      throw new DomainError(
        'INVALID_MOVE',
        'Só dá para esconder carta da segunda rodada em diante',
      );
    const mine = hand.cards[seat];
    const index = mine.findIndex((c) => c.id === cardId);
    if (index < 0)
      throw new DomainError('INVALID_MOVE', 'Essa carta não está na sua mão');
    // Flor é opcional: quem joga a primeira carta sem cantar perde a flor.
    if (this.canSingFlor(hand, seat)) hand.florLost.push(seat);
    const [{ card }] = mine.splice(index, 1);

    const round = hand.rounds[hand.rounds.length - 1];
    round.plays.push({ seat, card, hidden });
    const out: Announcement[] = [
      {
        event: 'gauderio:card_played',
        payload: {
          seat,
          card: hidden ? null : { ...card },
          hidden,
          round: hand.rounds.length,
        },
      },
    ];
    if (round.plays.length < this.settings.size) {
      hand.turn = this.next(seat);
      return out;
    }
    return [...out, ...this.closeRound(hand, round)];
  }

  /**
   * Um canto. Vindo da dupla que responde a um canto pendente, é um voto de aumento.
   * `solo`: o voto decide sozinho (parceiro ausente ou CPU).
   */
  call(seat: GaudSeat, call: GaudCall, solo = false): Announcement[] {
    const hand = this.requireHand();
    if (hand.pending && hand.pending.team !== gaudTeamOf(seat))
      return this.vote(hand, seat, call, solo);
    return this.applyCall(seat, call);
  }

  /** Quero / não quero: um voto da dupla que responde. */
  respond(seat: GaudSeat, accept: boolean, solo = false): Announcement[] {
    const hand = this.requireHand();
    return this.vote(hand, seat, accept ? 'accept' : 'decline', solo);
  }

  /** `absent` saiu da votação: decide com o voto do parceiro, se já votou. */
  resolveVotes(absent: GaudSeat): Announcement[] {
    const hand = this.active();
    const partner = this.partnerOf(absent);
    if (!hand?.pending || partner === null) return [];
    if (!hand.votes.some((v) => v.seat === partner)) return [];
    return this.decideVotes(hand);
  }

  /**
   * Em duplas a resposta é votada: decide quando os dois votam (ou na hora, com
   * `solo` / mano a mano). Se discordarem, vale o voto mais ousado. Até lá dá para
   * trocar o voto.
   */
  private vote(
    hand: Hand,
    seat: GaudSeat,
    choice: GaudVote,
    solo: boolean,
  ): Announcement[] {
    const error =
      choice === 'accept' || choice === 'decline'
        ? this.respondError(seat, choice === 'accept')
        : this.callError(seat, choice);
    if (error) throw new DomainError('INVALID_MOVE', error);
    hand.votes = [
      ...hand.votes.filter((v) => v.seat !== seat),
      { seat, choice },
    ];
    const partner = this.partnerOf(seat);
    if (
      !solo &&
      partner !== null &&
      !hand.votes.some((v) => v.seat === partner)
    )
      return [
        { event: 'gauderio:voted', payload: { seat, team: gaudTeamOf(seat) } },
      ];
    return this.decideVotes(hand);
  }

  private decideVotes(hand: Hand): Announcement[] {
    const { seat, choice } = hand.votes.reduce((best, v) =>
      boldness(v.choice) > boldness(best.choice) ? v : best,
    );
    hand.votes = [];
    if (choice === 'accept' || choice === 'decline')
      return this.applyRespond(seat, choice === 'accept');
    return this.applyCall(seat, choice);
  }

  private applyCall(seat: GaudSeat, call: GaudCall): Announcement[] {
    const hand = this.requireHand();
    hand.votes = [];
    const error = this.callError(seat, call);
    if (error) throw new DomainError('INVALID_MOVE', error);
    const team = gaudTeamOf(seat);
    const kind = gaudCallKind(call);
    const pending = hand.pending;
    const out: Announcement[] = [
      { event: 'gauderio:called', payload: { seat, team, call } },
    ];

    if (kind === 'truco') {
      if (pending) {
        // Aumentar é aceitar o pedido anterior.
        hand.trucoValue =
          GAUD_TRUCO_VALUE[pending.call as keyof typeof GAUD_TRUCO_VALUE];
        hand.trucoLastRaiseTeam = pending.team;
      }
      hand.pending = {
        kind,
        call,
        chain: [...(pending?.chain ?? []), call],
        seat,
        team,
      };
      hand.phase = 'AWAITING_RESPONSE';
      return out;
    }

    if (kind === 'envido') {
      if (pending?.kind === 'truco') hand.trucoOnHold = pending;
      const chain =
        pending?.kind === 'envido' ? [...pending.chain, call] : [call];
      hand.pending = { kind, call, chain, seat, team };
      hand.phase = 'AWAITING_RESPONSE';
      return out;
    }

    if (call !== 'flor') {
      hand.pending = {
        kind,
        call,
        chain: [...pending!.chain, call],
        seat,
        team,
      };
      return out;
    }

    // Flor: anula qualquer envido (cantado ou por cantar).
    hand.florDeclared = true;
    hand.envidoClosed = true;
    if (pending?.kind === 'truco') hand.trucoOnHold = pending;
    hand.pending = null;
    if (this.florHolders(hand, otherTeam(team)).length === 0) {
      return [
        ...out,
        ...this.resolveSide(hand, {
          kind: 'flor',
          winnerTeam: team,
          seat,
          chain: ['flor'],
          points: GAUD_FLOR_POINTS,
          accepted: false,
          outcome: 'uncontested',
          teamPoints: [null, null],
          bestSeats: [null, null],
        }),
      ];
    }
    hand.pending = { kind, call, chain: [call], seat, team };
    hand.phase = 'AWAITING_RESPONSE';
    return out;
  }

  private applyRespond(seat: GaudSeat, accept: boolean): Announcement[] {
    const hand = this.requireHand();
    const error = this.respondError(seat, accept);
    if (error) throw new DomainError('INVALID_MOVE', error);
    const pending = hand.pending!;
    const out: Announcement[] = [
      {
        event: 'gauderio:responded',
        payload: { seat, accept, call: pending.call },
      },
    ];
    hand.pending = null;

    if (pending.kind === 'truco') {
      if (!accept)
        return [
          ...out,
          ...this.endHand(hand, pending.team, hand.trucoValue, 'declined'),
        ];
      hand.trucoValue =
        GAUD_TRUCO_VALUE[pending.call as keyof typeof GAUD_TRUCO_VALUE];
      hand.trucoLastRaiseTeam = pending.team;
      hand.phase = 'AWAITING_PLAY';
      return out;
    }

    if (pending.kind === 'envido') {
      hand.envidoClosed = true;
      if (!accept) {
        const before = pending.chain.slice(0, -1);
        const points =
          before.length === 0
            ? 1
            : envidoChainValue(before, this.scores, this.settings.target);
        return [
          ...out,
          ...this.resolveSide(hand, {
            kind: 'envido',
            winnerTeam: pending.team,
            seat: pending.seat,
            chain: pending.chain,
            points,
            accepted: false,
            outcome: 'declined',
            teamPoints: [null, null],
            bestSeats: [null, null],
          }),
        ];
      }
      const points = envidoChainValue(
        pending.chain,
        this.scores,
        this.settings.target,
      );
      const duel = this.compare(hand, (s) => envidoPoints(hand.dealt[s]));
      return [
        ...out,
        ...this.resolveSide(hand, {
          kind: 'envido',
          points,
          accepted: true,
          outcome: 'compared',
          seat: duel.bestSeats[duel.winnerTeam]!,
          chain: pending.chain,
          ...duel,
        }),
      ];
    }

    // Flor contra flor.
    if (!accept) {
      const points =
        pending.call === 'contraflor_resto' &&
        pending.chain.includes('contraflor')
          ? GAUD_CONTRAFLOR_POINTS
          : GAUD_FLOR_DECLINED_POINTS;
      return [
        ...out,
        ...this.resolveSide(hand, {
          kind: 'flor',
          winnerTeam: pending.team,
          seat: pending.seat,
          chain: pending.chain,
          points,
          accepted: false,
          outcome: 'declined',
          teamPoints: [null, null],
          bestSeats: [null, null],
        }),
      ];
    }
    const points =
      pending.call === 'contraflor_resto'
        ? faltaPoints(this.scores, this.settings.target)
        : GAUD_CONTRAFLOR_POINTS;
    const duel = this.compare(hand, (s) =>
      this.holdsFlor(hand, s) ? florPoints(hand.dealt[s]) : null,
    );
    return [
      ...out,
      ...this.resolveSide(hand, {
        kind: 'flor',
        points,
        accepted: true,
        outcome: 'compared',
        seat: duel.bestSeats[duel.winnerTeam]!,
        chain: pending.chain,
        ...duel,
      }),
    ];
  }

  /** Ir ao baralho: entrega a mão pelo valor atual do truco. */
  fold(seat: GaudSeat): Announcement[] {
    const hand = this.requireHand();
    if (hand.phase !== 'AWAITING_PLAY')
      throw new DomainError('INVALID_STATE', 'Responda o canto primeiro');
    if (hand.turn !== seat)
      throw new DomainError('NOT_YOUR_TURN', 'Só na sua vez');
    const team = gaudTeamOf(seat);
    return [
      { event: 'gauderio:folded', payload: { seat, team } },
      ...this.endHand(hand, otherTeam(team), hand.trucoValue, 'folded'),
    ];
  }

  /** Alguém saiu de vez: a outra dupla vence por W.O. */
  abandon(leavingTeam: GaudTeam): Announcement[] {
    if (this.winnerTeam !== null) return [];
    this.winnerTeam = otherTeam(leavingTeam);
    if (this.hand) {
      this.hand.phase = 'HAND_OVER';
      this.hand.pending = null;
      this.hand.trucoOnHold = null;
      this.hand.votes = [];
    }
    return [
      {
        event: 'gauderio:match_over',
        payload: {
          winnerTeam: this.winnerTeam,
          reason: 'abandoned',
          scores: [...this.scores],
          finish: null,
        },
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Visões
  // -------------------------------------------------------------------------

  publicView(): GaudMatchView | null {
    const hand = this.hand;
    if (!hand) return null;
    return {
      handNumber: hand.number,
      dealer: this.dealer,
      mano: hand.mano,
      phase: hand.phase,
      turn: hand.turn,
      trucoValue: hand.trucoValue,
      trucoLastRaiseTeam: hand.trucoLastRaiseTeam,
      pending: hand.pending && {
        ...hand.pending,
        chain: [...hand.pending.chain],
        votes: hand.votes.length,
      },
      trucoOnHold: hand.trucoOnHold !== null,
      envidoClosed: hand.envidoClosed || hand.rounds.length > 1,
      sideResults: hand.sideResults.map((r) => ({
        ...r,
        chain: [...r.chain],
        teamPoints: [...r.teamPoints],
        bestSeats: [...r.bestSeats],
      })),
      rounds: hand.rounds.map((r) => ({
        plays: r.plays.map((p) => ({
          seat: p.seat,
          card: p.hidden ? null : { ...p.card },
          hidden: p.hidden,
        })),
        result: r.result,
        winningSeat: r.winningSeat,
      })),
      cardsLeft: hand.cards.map((c) => c.length),
      lastHandResult: hand.result && { ...hand.result },
    };
  }

  privateView(seat: GaudSeat): GaudPrivateHand | null {
    const hand = this.hand;
    if (!hand || seat >= this.settings.size) return null;
    return {
      handNumber: hand.number,
      cards: hand.cards[seat].map((c) => ({ id: c.id, card: { ...c.card } })),
      envido: envidoPoints(hand.dealt[seat]),
      envidoCards: envidoBest(hand.dealt[seat]).cards.map((c) => ({ ...c })),
      flor: this.holdsFlor(hand, seat),
      actions: this.actionsOf(seat),
      votes: this.votesOf(hand, seat),
    };
  }

  private votesOf(hand: Hand, seat: GaudSeat): GaudPrivateHand['votes'] {
    const pending = hand.pending;
    if (!pending || hand.phase !== 'AWAITING_RESPONSE') return null;
    if (pending.team === gaudTeamOf(seat)) return null;
    const of = (s: GaudSeat | null) =>
      hand.votes.find((v) => v.seat === s)?.choice ?? null;
    return { mine: of(seat), partner: of(this.partnerOf(seat)) };
  }

  actionsOf(seat: GaudSeat): GaudActions {
    const hand = this.active();
    const none: GaudActions = {
      canPlay: false,
      canHide: false,
      canFold: false,
      calls: [],
      canAccept: false,
      canDecline: false,
      envidoNote: null,
    };
    if (!hand) return none;
    const myTurn = hand.phase === 'AWAITING_PLAY' && hand.turn === seat;
    const canPlay = myTurn;
    const calls = GAUD_CALLS.filter((c) => this.callError(seat, c) === null);
    return {
      canPlay,
      canHide: canPlay && hand.rounds.length > 1,
      canFold: myTurn,
      calls,
      envidoNote: this.envidoNote(hand, seat, calls),
      canAccept: this.respondError(seat, true) === null,
      canDecline: this.respondError(seat, false) === null,
    };
  }

  /** Explica por que o envido não aparece enquanto ainda faz sentido pedir. */
  private envidoNote(
    hand: Hand,
    seat: GaudSeat,
    calls: readonly GaudCall[],
  ): string | null {
    if (calls.some((c) => gaudCallKind(c) === 'envido')) return null;
    if (hand.envidoClosed || hand.rounds.length > 1) return null;
    if (this.playedInFirstRound(hand, seat)) return null;
    const pending = hand.pending;
    if (pending?.kind === 'envido') return null;
    if (!pending && hand.turn !== seat)
      return 'O envido você pede na sua vez, antes de jogar a sua carta';
    return this.callError(seat, 'envido');
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  /** Melhores pontos de cada dupla; empate fica com quem está mais perto do mão. */
  private compare(
    hand: Hand,
    pointsOf: (seat: GaudSeat) => number | null,
  ): Pick<GaudSideResult, 'winnerTeam' | 'teamPoints' | 'bestSeats'> {
    const teamPoints: [number | null, number | null] = [null, null];
    const bestSeats: [GaudSeat | null, GaudSeat | null] = [null, null];
    for (const seat of this.orderFrom(hand.mano)) {
      const points = pointsOf(seat);
      const team = gaudTeamOf(seat);
      if (points === null) continue;
      if (teamPoints[team] === null || points > teamPoints[team]) {
        teamPoints[team] = points;
        bestSeats[team] = seat;
      }
    }
    const [a, b] = teamPoints.map((p) => p ?? -1);
    let winnerTeam: GaudTeam;
    if (a !== b) winnerTeam = a > b ? 0 : 1;
    else {
      const order = this.orderFrom(hand.mano);
      winnerTeam = gaudTeamOf(
        order.find((s) => s === bestSeats[0] || s === bestSeats[1]) ??
          hand.mano,
      );
    }
    return { winnerTeam, teamPoints, bestSeats };
  }

  /** Fecha uma disputa de envido/flor, soma os pontos e retoma a mão. */
  private resolveSide(hand: Hand, result: GaudSideResult): Announcement[] {
    hand.sideResults.push(result);
    const out: Announcement[] = [
      { event: 'gauderio:side_resolved', payload: { ...result } },
      ...this.award(result.winnerTeam, result.points, {
        by: result.kind,
        points: result.points,
        side: result,
      }),
    ];
    if (this.winnerTeam !== null) {
      hand.phase = 'HAND_OVER';
      hand.trucoOnHold = null;
      return out;
    }
    if (hand.trucoOnHold) {
      hand.pending = hand.trucoOnHold;
      hand.trucoOnHold = null;
      hand.phase = 'AWAITING_RESPONSE';
    } else hand.phase = 'AWAITING_PLAY';
    return out;
  }

  private closeRound(hand: Hand, round: Round): Announcement[] {
    const strength = (p: Play) => (p.hidden ? 0 : gaudStrength(p.card));
    const best = Math.max(...round.plays.map(strength));
    const top = round.plays.filter((p) => strength(p) === best);
    const teams = new Set(top.map((p) => gaudTeamOf(p.seat)));
    round.winningSeat = top[0].seat;
    round.result = teams.size === 1 ? gaudTeamOf(top[0].seat) : 'tie';
    hand.envidoClosed = true;
    const out: Announcement[] = [
      {
        event: 'gauderio:round_ended',
        payload: {
          round: hand.rounds.length,
          result: round.result,
          winningSeat: round.winningSeat,
        },
      },
    ];
    const decided = handWinner(
      hand.rounds.map((r) => r.result as GaudTeam | 'tie'),
      gaudTeamOf(hand.mano),
    );
    if (decided === undefined) {
      hand.rounds.push({ plays: [], result: null, winningSeat: null });
      hand.turn = round.winningSeat;
      return out;
    }
    return [...out, ...this.endHand(hand, decided, hand.trucoValue, 'rounds')];
  }

  private endHand(
    hand: Hand,
    winner: GaudTeam,
    points: number,
    reason: GaudHandEndReason,
  ): Announcement[] {
    hand.phase = 'HAND_OVER';
    hand.pending = null;
    hand.trucoOnHold = null;
    hand.result = { winnerTeam: winner, points, reason };
    return [
      { event: 'gauderio:hand_ended', payload: { ...hand.result } },
      ...this.award(winner, points, { by: reason, points, side: null }),
    ];
  }

  private award(
    team: GaudTeam,
    points: number,
    finish: GaudFinish,
  ): Announcement[] {
    const target = this.settings.target;
    this.scores[team] = Math.min(target, this.scores[team] + points);
    const out: Announcement[] = [
      {
        event: 'gauderio:score_updated',
        payload: { scores: [...this.scores] },
      },
    ];
    if (this.scores[team] >= target && this.winnerTeam === null) {
      this.winnerTeam = team;
      this.finishInfo = finish;
      if (this.hand) {
        this.hand.votes = [];
        this.hand.phase = 'HAND_OVER';
        this.hand.pending = null;
      }
      out.push({
        event: 'gauderio:match_over',
        payload: {
          winnerTeam: team,
          reason: 'points',
          scores: [...this.scores],
          finish,
        },
      });
    }
    return out;
  }

  private requireHand(): Hand {
    const hand = this.active();
    if (!hand)
      throw new DomainError('INVALID_STATE', 'Nenhuma mão em andamento');
    return hand;
  }
}
