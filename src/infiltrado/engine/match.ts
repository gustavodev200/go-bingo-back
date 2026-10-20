import {
  INF_BUTTON,
  INF_BUTTON_COOLDOWN,
  INF_CHAT_HISTORY,
  INF_CRITICAL_TIME,
  INF_DT,
  INF_EJECT_TIME,
  INF_FIRST_KILL_COOLDOWN,
  INF_FIX_PANELS,
  INF_INTRO_TIME,
  INF_KILL_RANGE,
  INF_REPORT_RANGE,
  INF_RESULT_TIME,
  INF_SABOTAGE_COOLDOWN,
  INF_SABOTAGE_INFO,
  INF_STATIONS,
  INF_TASK_INFO,
  INF_USE_RANGE,
  INF_VENTS,
  INF_VISION_CREW,
  INF_VISION_DARK,
  INF_VISION_IMPOSTOR,
  infDist,
  infLineOfSight,
  infMove,
  type InfAct,
  type InfChatMessage,
  type InfEjection,
  type InfFrame,
  type InfFrameEvent,
  type InfInput,
  type InfMeetingStage,
  type InfPhase,
  type InfRole,
  type InfRules,
  type InfSabotage,
  type InfTeam,
  type InfWinReason,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { botThink, botVote, type BotMemory } from './bot';

/** Inputs older than this many ticks are dropped (lag spikes). */
const MAX_QUEUE = 6;
/** At most this many inputs are applied per tick (catch-up after jitter). */
const MAX_INPUTS_PER_TICK = 3;
/** Latency slack when checking task minimum durations (s). */
const TASK_SLACK = 0.4;

export interface MatchPlayer {
  seat: number;
  bot: boolean;
  role: InfRole;
  x: number;
  y: number;
  facing: -1 | 1;
  moving: boolean;
  alive: boolean;
  /** Left the room: out of every count. */
  gone: boolean;
  tasks: { station: number; done: boolean }[];
  killCd: number;
  vent: number;
  meetingsLeft: number;
  queue: InfInput[];
  lastSeq: number;
  openTask: { station: number; at: number } | null;
  holding: number;
  events: InfFrameEvent[];
  ai: BotMemory;
}

interface Sabotage {
  kind: InfSabotage;
  left: number | null;
  fixed: (0 | 1)[];
}

interface Meeting {
  caller: number;
  body: number | null;
  stage: InfMeetingStage;
  left: number;
  voters: number[];
  votes: Map<number, number>;
}

type SharedFrame = Pick<
  InfFrame,
  | 'phase'
  | 'phaseLeft'
  | 'taskBar'
  | 'sabotage'
  | 'buttonCd'
  | 'meeting'
  | 'eject'
> & { impostors: number[] };

export interface MatchResult {
  winner: InfTeam;
  reason: InfWinReason;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Where everybody stands at the start and after each meeting: a ring around the button. */
export function spawnPoint(
  index: number,
  total: number,
): { x: number; y: number } {
  const a = (index / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: INF_BUTTON.x + Math.cos(a) * 2.6,
    y: INF_BUTTON.y + Math.sin(a) * 2.2,
  };
}

/**
 * One match of Infiltrado: pure rules on a fixed time step, no transport and no
 * wall clock. The rooms service ticks it, routes actions in and frames out.
 */
export class InfMatch {
  readonly players = new Map<number, MatchPlayer>();
  phase: InfPhase = 'intro';
  phaseLeft = INF_INTRO_TIME;
  /** Simulated seconds since the start. */
  t = 0;
  bodies: { seat: number; x: number; y: number }[] = [];
  buttonCd = INF_BUTTON_COOLDOWN;
  sabotageCd = INF_SABOTAGE_COOLDOWN / 2;
  sabotage: Sabotage | null = null;
  meeting: Meeting | null = null;
  eject: InfEjection | null = null;
  result: MatchResult | null = null;
  readonly chat: InfChatMessage[] = [];
  private chatId = 0;

  constructor(
    seated: readonly { seat: number; bot: boolean }[],
    readonly rules: InfRules,
    impostors: number,
    private readonly rand: () => number,
  ) {
    const order = [...seated];
    const shuffle = <T>(list: T[]) => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list;
    };
    const roles = shuffle(
      order.map((_, i) => (i < impostors ? 'impostor' : 'crew')),
    );
    order.forEach((s, i) => {
      const spawn = spawnPoint(i, order.length);
      const tasks = shuffle(INF_STATIONS.map((st) => st.id))
        .slice(0, rules.tasks)
        .map((station) => ({ station, done: false }));
      this.players.set(s.seat, {
        seat: s.seat,
        bot: s.bot,
        role: roles[i],
        x: spawn.x,
        y: spawn.y,
        facing: spawn.x < INF_BUTTON.x ? 1 : -1,
        moving: false,
        alive: true,
        gone: false,
        tasks,
        killCd: INF_FIRST_KILL_COOLDOWN,
        vent: -1,
        meetingsLeft: rules.emergencyMeetings,
        queue: [],
        lastSeq: 0,
        openTask: null,
        holding: -1,
        events: [],
        ai: {},
      });
    });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  player(seat: number): MatchPlayer | undefined {
    return this.players.get(seat);
  }

  private require(seat: number): MatchPlayer {
    const p = this.players.get(seat);
    if (!p || p.gone)
      throw new DomainError('INVALID_STATE', 'Você não está nesta partida');
    return p;
  }

  impostorSeats(): number[] {
    return [...this.players.values()]
      .filter((p) => p.role === 'impostor')
      .map((p) => p.seat);
  }

  /** Crew task progress over everybody still in the room (ghosts included). */
  taskProgress(): { done: number; total: number } {
    let done = 0;
    let total = 0;
    for (const p of this.players.values()) {
      if (p.gone || p.role !== 'crew') continue;
      total += p.tasks.length;
      done += p.tasks.filter((t) => t.done).length;
    }
    return { done, total };
  }

  visionOf(p: MatchPlayer): number {
    if (p.role === 'impostor') return INF_VISION_IMPOSTOR;
    return this.sabotage?.kind === 'lights' ? INF_VISION_DARK : INF_VISION_CREW;
  }

  /** Whether `viewer` can currently see the point (alive players only; ghosts see all). */
  sees(viewer: MatchPlayer, x: number, y: number): boolean {
    if (!viewer.alive) return true;
    return (
      infDist(viewer.x, viewer.y, x, y) <= this.visionOf(viewer) &&
      infLineOfSight(viewer.x, viewer.y, x, y)
    );
  }

  private alivePlayers(): MatchPlayer[] {
    return [...this.players.values()].filter((p) => p.alive && !p.gone);
  }

  // -------------------------------------------------------------------------
  // Input and actions
  // -------------------------------------------------------------------------

  pushInput(seat: number, input: InfInput): void {
    const p = this.players.get(seat);
    if (!p || p.bot || p.gone) return;
    p.queue.push(input);
    if (p.queue.length > MAX_QUEUE)
      p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  act(seat: number, a: InfAct): void {
    const p = this.require(seat);
    this.shared = null;
    switch (a.t) {
      case 'task_open':
        return this.taskOpen(p, a.station);
      case 'task_done':
        return this.taskDone(p, a.station);
      case 'kill':
        return this.kill(p, a.target);
      case 'report':
        return this.report(p, a.body);
      case 'emergency':
        return this.emergency(p);
      case 'vent_enter':
        return this.ventEnter(p);
      case 'vent_exit':
        return this.ventExit(p);
      case 'vent_move':
        return this.ventMove(p, a.to);
      case 'sabotage':
        return this.sabotageStart(p, a.kind);
      case 'fix':
        return this.fix(p, a.panel);
      case 'hold':
        return this.hold(p, a.panel, a.on);
      case 'vote':
        return this.vote(p, a.target);
    }
  }

  private requirePlay(): void {
    if (this.phase !== 'play')
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private requireAlive(p: MatchPlayer): void {
    if (!p.alive)
      throw new DomainError('INVALID_STATE', 'Fantasmas não podem fazer isso');
  }

  private near(
    p: MatchPlayer,
    x: number,
    y: number,
    range = INF_USE_RANGE,
  ): boolean {
    return infDist(p.x, p.y, x, y) <= range;
  }

  taskOpen(p: MatchPlayer, station: number): void {
    this.requirePlay();
    if (p.role !== 'crew')
      throw new DomainError('INVALID_STATE', 'Infiltrados só fingem tarefas');
    const task = p.tasks.find((t) => t.station === station && !t.done);
    if (!task) throw new DomainError('INVALID_STATE', 'Essa tarefa não é sua');
    const st = INF_STATIONS[station];
    if (!this.near(p, st.x, st.y))
      throw new DomainError('INVALID_STATE', 'Chegue mais perto do painel');
    p.openTask = { station, at: this.t };
  }

  taskDone(p: MatchPlayer, station: number): void {
    this.requirePlay();
    const task = p.tasks.find((t) => t.station === station && !t.done);
    const st = INF_STATIONS[station];
    if (p.role !== 'crew' || !task || p.openTask?.station !== station)
      throw new DomainError('INVALID_STATE', 'Abra a tarefa primeiro');
    if (!this.near(p, st.x, st.y, INF_USE_RANGE + 0.6))
      throw new DomainError('INVALID_STATE', 'Você se afastou do painel');
    if (
      this.t - p.openTask.at <
      INF_TASK_INFO[st.type].minMs / 1000 - TASK_SLACK
    )
      throw new DomainError('INVALID_STATE', 'Rápido demais!');
    task.done = true;
    p.openTask = null;
    p.events.push({ k: 'task', station });
    this.checkWin('tasks');
  }

  kill(p: MatchPlayer, target: number): void {
    this.requirePlay();
    this.requireAlive(p);
    if (p.role !== 'impostor')
      throw new DomainError('INVALID_STATE', 'Só infiltrados eliminam');
    if (p.vent >= 0)
      throw new DomainError('INVALID_STATE', 'Saia do duto antes');
    if (p.killCd > 0)
      throw new DomainError('INVALID_STATE', 'Ainda recarregando');
    const v = this.players.get(target);
    if (!v || v.gone || !v.alive || v.role === 'impostor' || v.vent >= 0)
      throw new DomainError('INVALID_STATE', 'Alvo inválido');
    if (
      !this.near(p, v.x, v.y, INF_KILL_RANGE) ||
      !infLineOfSight(p.x, p.y, v.x, v.y)
    )
      throw new DomainError('INVALID_STATE', 'Longe demais');
    v.alive = false;
    v.holding = -1;
    v.openTask = null;
    v.queue = [];
    this.bodies.push({ seat: v.seat, x: v.x, y: v.y });
    p.x = v.x;
    p.y = v.y;
    p.killCd = this.rules.killCooldown;
    // CPU crewmates who saw it will vote for the killer.
    for (const q of this.players.values())
      if (
        q.bot &&
        q.alive &&
        !q.gone &&
        q.role === 'crew' &&
        this.sees(q, p.x, p.y)
      )
        q.ai.suspect = p.seat;
    v.events.push({ k: 'killed', by: p.seat });
    p.events.push({ k: 'kill' });
    this.checkWin('kills');
  }

  report(p: MatchPlayer, bodySeat: number): void {
    this.requirePlay();
    this.requireAlive(p);
    const body = this.bodies.find((b) => b.seat === bodySeat);
    if (!body) throw new DomainError('INVALID_STATE', 'Corpo não encontrado');
    if (
      p.vent >= 0 ||
      !this.near(p, body.x, body.y, INF_REPORT_RANGE) ||
      !infLineOfSight(p.x, p.y, body.x, body.y)
    )
      throw new DomainError('INVALID_STATE', 'Chegue mais perto do corpo');
    this.startMeeting(p.seat, bodySeat);
  }

  emergency(p: MatchPlayer): void {
    this.requirePlay();
    this.requireAlive(p);
    if (
      p.vent >= 0 ||
      !this.near(p, INF_BUTTON.x, INF_BUTTON.y, INF_USE_RANGE + 0.5)
    )
      throw new DomainError('INVALID_STATE', 'Vá até o botão no Átrio');
    if (p.meetingsLeft <= 0)
      throw new DomainError('INVALID_STATE', 'Você já usou suas reuniões');
    if (this.buttonCd > 0)
      throw new DomainError('INVALID_STATE', 'O botão ainda está travado');
    if (this.sabotage && INF_SABOTAGE_INFO[this.sabotage.kind].critical)
      throw new DomainError(
        'INVALID_STATE',
        'Emergência em andamento! Conserte primeiro',
      );
    p.meetingsLeft--;
    this.startMeeting(p.seat, null);
  }

  private requireImpostorMove(p: MatchPlayer): void {
    this.requirePlay();
    this.requireAlive(p);
    if (p.role !== 'impostor')
      throw new DomainError('INVALID_STATE', 'Só infiltrados usam os dutos');
  }

  ventEnter(p: MatchPlayer): void {
    this.requireImpostorMove(p);
    if (p.vent >= 0) return;
    const vent = INF_VENTS.find((v) => this.near(p, v.x, v.y));
    if (!vent) throw new DomainError('INVALID_STATE', 'Nenhum duto por perto');
    p.vent = vent.id;
    p.x = vent.x;
    p.y = vent.y;
    p.holding = -1;
    p.events.push({ k: 'vent' });
  }

  ventExit(p: MatchPlayer): void {
    this.requireImpostorMove(p);
    if (p.vent < 0) return;
    p.vent = -1;
    p.events.push({ k: 'vent' });
  }

  ventMove(p: MatchPlayer, to: number): void {
    this.requireImpostorMove(p);
    if (p.vent < 0 || !INF_VENTS[p.vent].links.includes(to))
      throw new DomainError('INVALID_STATE', 'Esse duto não se liga a este');
    const v = INF_VENTS[to];
    p.vent = to;
    p.x = v.x;
    p.y = v.y;
  }

  sabotageStart(p: MatchPlayer, kind: InfSabotage): void {
    this.requirePlay();
    if (p.role !== 'impostor')
      throw new DomainError('INVALID_STATE', 'Só infiltrados sabotam');
    if (this.sabotage)
      throw new DomainError('INVALID_STATE', 'Já existe uma sabotagem ativa');
    if (this.sabotageCd > 0)
      throw new DomainError('INVALID_STATE', 'Sabotagem recarregando');
    this.sabotage = {
      kind,
      left: INF_SABOTAGE_INFO[kind].critical ? INF_CRITICAL_TIME : null,
      fixed: INF_FIX_PANELS[kind].map(() => 0 as const),
    };
    this.sabotageCd = INF_SABOTAGE_COOLDOWN;
    for (const q of this.players.values())
      q.events.push({ k: 'sabotage', kind });
  }

  fix(p: MatchPlayer, panel: number): void {
    this.requirePlay();
    this.requireAlive(p);
    const s = this.sabotage;
    if (!s || s.kind === 'reactor')
      throw new DomainError('INVALID_STATE', 'Nada para consertar aqui');
    const pos = INF_FIX_PANELS[s.kind][panel];
    if (!pos || !this.near(p, pos.x, pos.y, INF_USE_RANGE + 0.6))
      throw new DomainError('INVALID_STATE', 'Chegue mais perto do painel');
    s.fixed[panel] = 1;
    if (s.fixed.every((f) => f === 1)) this.resolveSabotage();
  }

  hold(p: MatchPlayer, panel: number, on: boolean): void {
    if (!on) {
      if (p.holding === panel) p.holding = -1;
      return;
    }
    this.requirePlay();
    this.requireAlive(p);
    if (this.sabotage?.kind !== 'reactor')
      throw new DomainError('INVALID_STATE', 'O reator está estável');
    const pos = INF_FIX_PANELS.reactor[panel];
    if (!this.near(p, pos.x, pos.y))
      throw new DomainError('INVALID_STATE', 'Chegue mais perto do scanner');
    p.holding = panel;
  }

  private resolveSabotage(): void {
    const kind = this.sabotage!.kind;
    this.sabotage = null;
    for (const q of this.players.values()) {
      q.holding = -1;
      q.events.push({ k: 'fixed', kind });
    }
  }

  vote(p: MatchPlayer, target: number): void {
    const m = this.meeting;
    if (this.phase !== 'meeting' || !m || m.stage !== 'vote')
      throw new DomainError('INVALID_STATE', 'A votação não está aberta');
    if (!m.voters.includes(p.seat))
      throw new DomainError('INVALID_STATE', 'Fantasmas não votam');
    if (m.votes.has(p.seat))
      throw new DomainError('INVALID_STATE', 'Você já votou');
    if (target >= 0 && !m.voters.includes(target))
      throw new DomainError('INVALID_STATE', 'Voto inválido');
    m.votes.set(p.seat, target);
    if (m.voters.every((s) => m.votes.has(s))) this.closeVoting();
  }

  /** Meeting talk for the living; ghosts talk among themselves at any time. */
  say(seat: number, text: string): { message: InfChatMessage } {
    const p = this.require(seat);
    if (p.alive && this.phase !== 'meeting')
      throw new DomainError('INVALID_STATE', 'O chat só abre nas reuniões');
    const message: InfChatMessage = {
      id: ++this.chatId,
      seat,
      text,
      ghost: !p.alive,
    };
    this.chat.push(message);
    if (this.chat.length > INF_CHAT_HISTORY) this.chat.shift();
    return { message };
  }

  /** Chat visible to `seat` (ghost talk only for ghosts). */
  chatFor(seat: number): InfChatMessage[] {
    const p = this.players.get(seat);
    const ghost = !!p && !p.alive;
    return this.chat.filter((m) => !m.ghost || ghost);
  }

  // -------------------------------------------------------------------------
  // Leaving
  // -------------------------------------------------------------------------

  /** A player left the room for good: out of every count; no body is left behind. */
  remove(seat: number): void {
    const p = this.players.get(seat);
    if (!p || p.gone) return;
    p.gone = true;
    p.alive = false;
    p.holding = -1;
    p.vent = -1;
    if (this.meeting) {
      this.meeting.voters = this.meeting.voters.filter((s) => s !== seat);
      this.meeting.votes.delete(seat);
      for (const [voter, target] of this.meeting.votes)
        if (target === seat) this.meeting.votes.set(voter, -1);
      if (
        this.meeting.stage === 'vote' &&
        this.meeting.voters.every((s) => this.meeting!.votes.has(s))
      )
        this.closeVoting();
    }
    this.checkWin('left');
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  tick(): void {
    const dt = INF_DT;
    this.t += dt;
    // Nobody reads the bots' frames.
    for (const p of this.players.values())
      if (p.bot || p.gone) p.events.length = 0;
    switch (this.phase) {
      case 'intro':
        this.drainInputs(false);
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.phase = 'play';
        return;
      case 'play':
        return this.tickPlay(dt);
      case 'meeting':
        this.drainInputs(false);
        return this.tickMeeting(dt);
      case 'eject':
        this.drainInputs(false);
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.afterEject();
        return;
      case 'over':
        return;
    }
  }

  private drainInputs(move: boolean): void {
    for (const p of this.players.values()) {
      if (p.bot) continue;
      const batch = p.queue.splice(0, MAX_INPUTS_PER_TICK);
      p.moving = false;
      for (const input of batch) {
        p.lastSeq = input.s;
        if (!move || p.gone || (p.alive && p.vent >= 0)) continue;
        this.step(p, input.x, input.y);
      }
    }
  }

  /** One fixed step of movement for `p` (same as the client prediction). */
  step(p: MatchPlayer, jx: number, jy: number): void {
    const bx = p.x;
    const by = p.y;
    infMove(p, jx, jy, INF_DT, !p.alive);
    if (jx > 0.1) p.facing = 1;
    else if (jx < -0.1) p.facing = -1;
    if (p.x !== bx || p.y !== by) p.moving = true;
  }

  private tickPlay(dt: number): void {
    this.drainInputs(true);
    for (const p of this.players.values())
      if (p.bot && !p.gone) {
        p.moving = false;
        try {
          botThink(this, p, this.rand);
        } catch {
          // A plan that stopped making sense (target gone, out of reach): think again next tick.
          p.ai = { fake: p.ai.fake };
        }
        if (this.phase !== 'play') return;
      }

    this.buttonCd = Math.max(0, this.buttonCd - dt);
    this.sabotageCd = Math.max(0, this.sabotageCd - dt);
    for (const p of this.players.values()) {
      if (p.role === 'impostor' && p.alive && p.vent < 0)
        p.killCd = Math.max(0, p.killCd - dt);
      // Walking away from a console closes it.
      if (p.openTask) {
        const st = INF_STATIONS[p.openTask.station];
        if (!this.near(p, st.x, st.y, INF_USE_RANGE + 1)) p.openTask = null;
      }
    }

    const s = this.sabotage;
    if (s?.kind === 'reactor') {
      const holders = INF_FIX_PANELS.reactor.map((pos, panel) =>
        this.alivePlayers().some((p) => {
          if (p.holding !== panel) return false;
          if (!this.near(p, pos.x, pos.y, INF_USE_RANGE + 0.6)) {
            p.holding = -1;
            return false;
          }
          return true;
        }),
      );
      s.fixed = holders.map((h) => (h ? 1 : 0));
      if (holders.every(Boolean)) this.resolveSabotage();
    }
    if (this.sabotage?.left != null) {
      this.sabotage.left -= dt;
      if (this.sabotage.left <= 0) {
        this.sabotage.left = 0;
        this.finish('impostor', 'sabotage');
      }
    }
  }

  private startMeeting(caller: number, body: number | null): void {
    this.phase = 'meeting';
    this.bodies = [];
    this.sabotage = null;
    const alive = this.alivePlayers();
    const all = [...this.players.values()].filter((p) => !p.gone);
    all.forEach((p, i) => {
      p.vent = -1;
      p.holding = -1;
      p.openTask = null;
      p.queue = [];
      p.moving = false;
      p.ai = { fake: p.ai.fake, suspect: p.ai.suspect };
      const spawn = spawnPoint(i, all.length);
      p.x = spawn.x;
      p.y = spawn.y;
    });
    const talk = this.rules.discussionTime > 0;
    this.meeting = {
      caller,
      body,
      stage: talk ? 'talk' : 'vote',
      left: talk ? this.rules.discussionTime : this.rules.votingTime,
      voters: alive.map((p) => p.seat),
      votes: new Map(),
    };
  }

  private tickMeeting(dt: number): void {
    const m = this.meeting!;
    if (m.stage === 'vote')
      for (const p of this.players.values())
        if (
          p.bot &&
          !p.gone &&
          m.voters.includes(p.seat) &&
          !m.votes.has(p.seat)
        ) {
          const target = botVote(
            this,
            p,
            m.votes,
            m.left,
            this.rules.votingTime,
            this.rand,
          );
          if (target !== undefined) {
            this.vote(
              p,
              target >= 0 && !m.voters.includes(target) ? -1 : target,
            );
            if (m.stage !== 'vote') break;
          }
        }
    m.left -= dt;
    if (m.left > 0) return;
    if (m.stage === 'talk') {
      m.stage = 'vote';
      m.left = this.rules.votingTime;
    } else if (m.stage === 'vote') this.closeVoting();
    else this.startEject();
  }

  private closeVoting(): void {
    const m = this.meeting!;
    m.stage = 'result';
    m.left = INF_RESULT_TIME;
  }

  private startEject(): void {
    const m = this.meeting!;
    const tally = new Map<number, number>();
    for (const target of m.votes.values())
      tally.set(target, (tally.get(target) ?? 0) + 1);
    let top = -1;
    let topCount = 0;
    let tie = false;
    for (const [target, count] of tally) {
      if (count > topCount) {
        top = target;
        topCount = count;
        tie = false;
      } else if (count === topCount) tie = true;
    }
    const seat = !tie && top >= 0 ? top : null;
    const ejected = seat !== null ? this.players.get(seat) : undefined;
    if (ejected) ejected.alive = false;
    const confirm = this.rules.confirmEjects;
    const impostorsLeft = this.alivePlayers().filter(
      (p) => p.role === 'impostor',
    ).length;
    this.eject = {
      seat: ejected ? seat : null,
      tie: tie && topCount > 0,
      wasImpostor: ejected && confirm ? ejected.role === 'impostor' : null,
      impostorsLeft: confirm ? impostorsLeft : null,
    };
    this.phase = 'eject';
    this.phaseLeft = INF_EJECT_TIME;
  }

  private afterEject(): void {
    this.meeting = null;
    this.eject = null;
    this.phase = 'play';
    this.checkWin('votes');
    if (this.phase !== 'play') return;
    this.buttonCd = INF_BUTTON_COOLDOWN;
    this.sabotageCd = Math.max(this.sabotageCd, INF_SABOTAGE_COOLDOWN / 2);
    for (const p of this.players.values())
      if (p.role === 'impostor') p.killCd = this.rules.killCooldown;
  }

  /** Ends the match when a side has won; `reason` explains what just happened. */
  private checkWin(reason: InfWinReason): void {
    if (this.phase === 'over') return;
    const alive = this.alivePlayers();
    const impostors = alive.filter((p) => p.role === 'impostor').length;
    const crew = alive.length - impostors;
    if (impostors === 0)
      return this.finish('crew', reason === 'kills' ? 'left' : reason);
    if (impostors >= crew)
      return this.finish('impostor', reason === 'tasks' ? 'left' : reason);
    const { done, total } = this.taskProgress();
    if (total > 0 && done >= total) this.finish('crew', 'tasks');
  }

  private finish(winner: InfTeam, reason: InfWinReason): void {
    this.phase = 'over';
    this.phaseLeft = 0;
    this.result = { winner, reason };
  }

  // -------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------

  private shared: (SharedFrame & { at: number; phase: InfPhase }) | null = null;

  /**
   * The part of the frame that is the same for every viewer, built once per
   * tick (a full room asks for 15 frames per tick).
   */
  private sharedFrame(): SharedFrame {
    const cached = this.shared;
    if (cached && cached.at === this.t && cached.phase === this.phase)
      return cached;
    const { done, total } = this.taskProgress();
    const m = this.meeting;
    const next = {
      at: this.t,
      phase: this.phase,
      phaseLeft: round1(Math.max(0, this.phaseLeft)),
      impostors: this.impostorSeats(),
      taskBar: total > 0 ? round2(done / total) : 0,
      sabotage: this.sabotage
        ? {
            kind: this.sabotage.kind,
            left:
              this.sabotage.left === null ? null : round1(this.sabotage.left),
            fixed: [...this.sabotage.fixed],
          }
        : null,
      buttonCd: round1(this.buttonCd),
      meeting: m
        ? {
            caller: m.caller,
            body: m.body,
            stage: m.stage,
            left: round1(Math.max(0, m.left)),
            voters: [...m.voters],
            voted: [...m.votes.keys()],
            votes:
              m.stage === 'result'
                ? ([...m.votes.entries()] as [number, number][])
                : null,
          }
        : null,
      eject: this.eject ? { ...this.eject } : null,
    };
    this.shared = next;
    return next;
  }

  /** Drops events nobody will read (disconnected players). */
  discardEvents(seat: number): void {
    const p = this.players.get(seat);
    if (p) p.events = [];
  }

  /** What `seat` sees this tick. Drains that player's events. */
  frameFor(seat: number): InfFrame {
    const me = this.players.get(seat)!;
    const inWorld = this.phase === 'play' || this.phase === 'intro';
    const players: InfFrame['players'] = [];
    const bodies: InfFrame['bodies'] = [];
    if (inWorld) {
      for (const p of this.players.values()) {
        if (p.gone || p.seat === seat) continue;
        if (me.alive) {
          if (!p.alive || p.vent >= 0) continue;
          if (!this.sees(me, p.x, p.y)) continue;
        }
        const flags =
          (p.alive ? 0 : 1) |
          (me.role === 'impostor' && p.role === 'impostor' ? 2 : 0);
        players.push([
          p.seat,
          round2(p.x),
          round2(p.y),
          p.facing,
          p.moving ? 1 : 0,
          flags,
        ]);
      }
      for (const b of this.bodies)
        if (this.sees(me, b.x, b.y))
          bodies.push([b.seat, round2(b.x), round2(b.y)]);
    }
    const sh = this.sharedFrame();
    const events = me.events;
    me.events = [];
    return {
      phase: sh.phase,
      phaseLeft: sh.phaseLeft,
      me: {
        x: round2(me.x),
        y: round2(me.y),
        alive: me.alive,
        role: me.role,
        mates:
          me.role === 'impostor' ? sh.impostors.filter((s) => s !== seat) : [],
        lastSeq: me.lastSeq,
        killCd: round1(me.killCd),
        sabotageCd: me.role === 'impostor' ? round1(this.sabotageCd) : 0,
        vent: me.vent,
        meetingsLeft: me.meetingsLeft,
        tasks: me.tasks.map((t) => [t.station, t.done ? 1 : 0]),
        holding: me.holding,
      },
      players,
      bodies,
      taskBar: sh.taskBar,
      sabotage: sh.sabotage,
      buttonCd: sh.buttonCd,
      meeting: sh.meeting,
      eject: sh.eject,
      events,
    };
  }
}
