import {
  BOTAO_COUNTDOWN,
  BOTAO_DT,
  BOTAO_END_PAUSE,
  BOTAO_FIELD_H,
  BOTAO_FIELD_W,
  BOTAO_GOAL_PAUSE,
  BOTAO_SUBSTEPS,
  botaoCollideDiscs,
  botaoConfineBall,
  botaoConfinePlayer,
  botaoGoalAt,
  botaoKick,
  botaoMoveBall,
  botaoMovePlayer,
  botaoNewBall,
  botaoNewPlayer,
  botaoSide,
  botaoTeamOf,
  type BotaoDisc,
  type BotaoFrame,
  type BotaoFrameEvent,
  type BotaoGoal,
  type BotaoKickoff,
  type BotaoMatchPhase,
  type BotaoRules,
} from '../../contracts';
import { botThink, type BotMemory } from './bot';

/** Float uniforme em [0, 1). Injetado para as partidas serem reproduzíveis nos testes. */
export type Rand = () => number;

export interface MatchInput {
  d: number;
  k: boolean;
  /** Sequência do cliente (CPU não tem). */
  s?: number;
}

export interface MatchPlayer {
  seat: number;
  team: number;
  bot: boolean;
  disc: BotaoDisc;
  queue: MatchInput[];
  lastSeq: number;
  /** Direção e chute deste tick. */
  d: number;
  kick: boolean;
  /** Pode chutar: volta a valer quando solta o botão. */
  armed: boolean;
  ai: BotMemory;
}

export interface MatchResult {
  winner: number;
  walkover: boolean;
}

const MAX_QUEUE = 8;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Posições de saída (frações do meio-campo) por quantidade de jogadores no time. */
const FORMATIONS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[0.45, 0]],
  [
    [0.4, -0.3],
    [0.4, 0.3],
  ],
  [
    [0.3, -0.45],
    [0.3, 0.45],
    [0.7, 0],
  ],
  [
    [0.25, -0.5],
    [0.25, 0.5],
    [0.6, -0.2],
    [0.6, 0.2],
  ],
];

/**
 * Uma partida de futebol de botão: física autoritativa, placar, tempo, gol de ouro e saída de bola.
 * Cada tick (30 Hz) roda BOTAO_SUBSTEPS passos de física e consome um comando de cada jogador.
 */
export class BotaoMatch {
  readonly players: MatchPlayer[];
  readonly ball: BotaoDisc = botaoNewBall();
  phase: BotaoMatchPhase = 'countdown';
  phaseT = BOTAO_COUNTDOWN;
  /** Segundos de jogo corridos no tempo normal. */
  elapsed = 0;
  overtime = false;
  overtimeT = 0;
  score: [number, number] = [0, 0];
  readonly goals: BotaoGoal[] = [];
  kickTeam: number;
  lastTouch: { seat: number; team: number } | null = null;
  result: MatchResult | null = null;
  tickN = 0;
  private events: BotaoFrameEvent[] = [];
  private fresh: BotaoGoal[] = [];

  constructor(
    participants: { seat: number; bot: boolean }[],
    readonly rules: BotaoRules,
    readonly rand: Rand,
  ) {
    this.players = participants.map(({ seat, bot }) => ({
      seat,
      team: botaoTeamOf(seat),
      bot,
      disc: botaoNewPlayer(0, 0),
      queue: [],
      lastSeq: 0,
      d: 0,
      kick: false,
      armed: true,
      ai: {},
    }));
    this.kickTeam = rand() < 0.5 ? 0 : 1;
    this.resetPositions();
  }

  get totalTime(): number {
    return this.rules.minutes * 60;
  }

  player(seat: number): MatchPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  teamSize(team: number): number {
    return this.players.filter((p) => p.team === team).length;
  }

  /** Kickoff em vigor (barreira do meio-campo), ou null. */
  get kickoff(): BotaoKickoff | null {
    return this.phase === 'kickoff' || this.phase === 'countdown'
      ? { kickTeam: this.kickTeam }
      : null;
  }

  pushInput(seat: number, input: MatchInput): void {
    const p = this.player(seat);
    if (!p || p.bot) return;
    p.queue.push(input);
    if (p.queue.length > MAX_QUEUE)
      p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  /** Saiu da sala: o botão some. Time vazio perde por W.O. */
  remove(seat: number): void {
    const i = this.players.findIndex((p) => p.seat === seat);
    if (i < 0) return;
    const [p] = this.players.splice(i, 1);
    if (this.lastTouch?.seat === seat) this.lastTouch = null;
    if (this.phase === 'over' || this.result) return;
    if (this.teamSize(p.team) === 0) {
      this.result = { winner: 1 - p.team, walkover: true };
      this.phase = 'over';
      this.emit({ k: 'end' });
    }
  }

  /** Gols marcados desde a última chamada (para a sala anunciar). */
  drainGoals(): BotaoGoal[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }

  private emit(e: BotaoFrameEvent): void {
    this.events.push(e);
  }

  resetPositions(): void {
    for (const team of [0, 1]) {
      const mine = this.players.filter((p) => p.team === team);
      const spots = FORMATIONS[Math.min(mine.length, 4)];
      const side = botaoSide(team);
      mine.forEach((p, i) => {
        const [fx, fy] = spots[i] ?? [0.5, 0];
        Object.assign(p.disc, {
          x: side * fx * BOTAO_FIELD_W,
          y: fy * BOTAO_FIELD_H,
          vx: 0,
          vy: 0,
        });
      });
    }
    Object.assign(this.ball, { x: 0, y: 0, vx: 0, vy: 0 });
    this.lastTouch = null;
  }

  tick(): void {
    this.tickN++;
    if (this.phase === 'over') return;

    if (this.phase === 'countdown') {
      this.phaseT -= BOTAO_DT;
      for (const p of this.players) {
        p.queue.length = 0;
        p.d = 0;
      }
      if (this.phaseT <= 0) {
        this.phase = 'kickoff';
        this.phaseT = 0;
        this.emit({ k: 'whistle' });
      }
      return;
    }

    this.readInputs();
    for (let i = 0; i < BOTAO_SUBSTEPS; i++) this.step();
    this.advanceClock();
  }

  private readInputs(): void {
    for (const p of this.players) {
      if (p.bot) {
        const input = botThink(this, p);
        p.d = input.d;
        p.kick = input.k;
      } else if (p.queue.length) {
        // Um comando por tick; dois quando o cliente está adiantado (a rede atrasou).
        const n = p.queue.length > 3 ? 2 : 1;
        for (let i = 0; i < n && p.queue.length; i++) {
          const input = p.queue.shift()!;
          p.lastSeq = input.s ?? p.lastSeq;
          p.d = input.d;
          p.kick = input.k;
        }
      } else p.d = 0;
      if (!p.kick) p.armed = true;
    }
  }

  private step(): void {
    const live = this.phase === 'kickoff' || this.phase === 'play';
    for (const p of this.players) botaoMovePlayer(p.disc, p.d, p.kick);
    botaoMoveBall(this.ball);

    for (let i = 0; i < this.players.length; i++)
      for (let j = i + 1; j < this.players.length; j++)
        botaoCollideDiscs(this.players[i].disc, this.players[j].disc);
    for (const p of this.players)
      if (botaoCollideDiscs(p.disc, this.ball)) this.touch(p, false);
    for (const p of this.players)
      if (p.kick && p.armed && botaoKick(p.disc, this.ball)) {
        p.armed = false;
        this.touch(p, true);
      }

    const kickoff = this.kickoff;
    for (const p of this.players) botaoConfinePlayer(p.disc, p.team, kickoff);
    const hit = botaoConfineBall(this.ball);
    if (hit.post) this.emit({ k: 'post' });

    if (!live) return;
    const goalIn = botaoGoalAt(this.ball);
    if (goalIn !== null) this.goal(1 - goalIn);
  }

  private touch(p: MatchPlayer, kicked: boolean): void {
    this.lastTouch = { seat: p.seat, team: p.team };
    if (kicked) this.emit({ k: 'kick', seat: p.seat });
    if (this.phase === 'kickoff') {
      this.phase = 'play';
      if (!kicked) this.emit({ k: 'touch' });
    }
  }

  private goal(team: number): void {
    const own = !!this.lastTouch && this.lastTouch.team !== team;
    const goal: BotaoGoal = {
      team,
      scorer: this.lastTouch?.seat ?? null,
      own,
      at: Math.floor(this.elapsed + this.overtimeT),
    };
    this.score[team]++;
    this.goals.push(goal);
    this.fresh.push(goal);
    this.emit({ k: 'goal', team, scorer: goal.scorer, own });
    this.emit({ k: 'net' });
    this.phase = 'goal';
    this.phaseT = BOTAO_GOAL_PAUSE;
    this.kickTeam = 1 - team;
  }

  private decided(): number | null {
    const [r, b] = this.score;
    const limit = this.rules.goals;
    if (limit > 0 && (r >= limit || b >= limit)) return r > b ? 0 : 1;
    if (this.overtime && r !== b) return r > b ? 0 : 1;
    if (!this.overtime && this.elapsed >= this.totalTime && r !== b)
      return r > b ? 0 : 1;
    return null;
  }

  private advanceClock(): void {
    const dt = BOTAO_DT;
    if (this.phase === 'goal' || this.phase === 'ending') {
      this.phaseT -= dt;
      if (this.phaseT > 0) return;
      const winner = this.decided();
      if (winner !== null) {
        this.result = { winner, walkover: false };
        this.phase = 'over';
        if (this.events.every((e) => e.k !== 'end')) this.emit({ k: 'end' });
        return;
      }
      if (!this.overtime && this.elapsed >= this.totalTime)
        this.overtime = true;
      this.resetPositions();
      this.phase = 'kickoff';
      this.phaseT = 0;
      this.emit({ k: 'whistle' });
      return;
    }

    if (this.overtime) {
      this.overtimeT += dt;
      return;
    }
    this.elapsed = Math.min(this.totalTime, this.elapsed + dt);
    if (this.elapsed < this.totalTime) return;
    // Fim do tempo: placar diferente acaba, empate vira gol de ouro.
    const over = this.decided() !== null;
    this.phase = 'ending';
    this.phaseT = over ? BOTAO_END_PAUSE : 1;
    this.emit(over ? { k: 'end' } : { k: 'whistle' });
  }

  /** Vista pública deste tick; esvazia os eventos juntados desde o último quadro. */
  frame(): BotaoFrame {
    const frame: BotaoFrame = {
      phase: this.phase,
      phaseLeft: r2(Math.max(0, this.phaseT)),
      clock: this.overtime
        ? Math.floor(this.overtimeT)
        : Math.ceil(this.totalTime - this.elapsed),
      overtime: this.overtime,
      kickTeam: this.kickTeam,
      score: [this.score[0], this.score[1]],
      players: this.players.map((p) => [
        p.seat,
        r2(p.disc.x),
        r2(p.disc.y),
        r2(p.disc.vx),
        r2(p.disc.vy),
        p.kick && p.armed ? 1 : 0,
        p.lastSeq,
      ]),
      ball: [
        r2(this.ball.x),
        r2(this.ball.y),
        r2(this.ball.vx),
        r2(this.ball.vy),
      ],
      events: this.events,
    };
    this.events = [];
    return frame;
  }
}
