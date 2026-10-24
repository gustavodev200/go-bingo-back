import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  BOTAO_SEATS,
  BOTAO_TEAM_SIZE,
  BOTAO_TICK_MS,
  BotaoServerEvents,
  DEFAULT_BOTAO_RULES,
  botaoTeamOf,
  type BotaoFrame,
  type BotaoInput,
  type BotaoLeftReason,
  type BotaoMatchResult,
  type BotaoPublicRoom,
  type BotaoRoomPhase,
  type BotaoRoomState,
  type BotaoRules,
  type BotaoSeatPlayer,
  type BotaoServerEventName,
  type BotaoServerEventPayloads,
  type BotaoSnapshot,
  minStake,
  stakeLevel,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker, rankSeats } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { BOTAO_PUBLISHER, type BotaoPublisher } from './botao-publisher';
import { BotaoMatch } from './engine/match';

export interface BotaoConfig {
  /** Quanto tempo o lugar de quem caiu fica reservado. */
  reconnectGraceMs: number;
  /** Limite de salas em memória. */
  maxRooms: number;
  /** Relógio dos prazos (injetável nos testes). */
  now?: () => number;
}
export const BOTAO_CONFIG = Symbol('BOTAO_CONFIG');

/** Identidade vem do token verificado; apelido/personagem do perfil salvo. */
export interface BotaoPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends BotaoPlayer {
  bot: boolean;
  ready: boolean;
  sockets: Set<string>;
  reconnectDeadline: number | null;
  expiryTimer: unknown;
}

interface Room {
  code: string;
  hostId: string;
  isPublic: boolean;
  /** Aposta de cada jogador (Arena); só muda no lobby. */
  stake: number;
  rules: BotaoRules;
  phase: BotaoRoomPhase;
  seats: (SeatState | null)[];
  match: BotaoMatch | null;
  /** Último quadro enviado, repetido (sem eventos) para quem reconecta. */
  lastFrame: BotaoFrame | null;
  result: BotaoMatchResult | null;
  /** Só humanos; com CPU na mesa a Arena liquida como partida contra a CPU (sem ranking). */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  tickTimer: unknown;
  botCount: number;
}

type Announcement = {
  [E in BotaoServerEventName]: {
    event: E;
    payload: Omit<BotaoServerEventPayloads[E], 'seq'>;
  };
}[BotaoServerEventName];

const teamSeats = (team: number) =>
  Array.from({ length: BOTAO_TEAM_SIZE }, (_, i) => team * BOTAO_TEAM_SIZE + i);

/**
 * Salas de futebol de botão em memória, autoritativas. Todo método é síncrono, então dois
 * eventos nunca se intercalam dentro de uma sala.
 *
 * Mesma política do Bomber:
 * - uma sala por usuário; quem volta recebe o mesmo lugar (e o mesmo time);
 * - quem cai fica com o lugar por `reconnectGraceMs` (o botão fica parado no campo). Depois,
 *   ou ao sair, está fora: no lobby o lugar vaga; na partida o botão some e, se o time ficar
 *   vazio, o outro vence por W.O.;
 * - CPU entra a pedido do anfitrião e nunca segura a sala viva;
 * - o anfitrião passa para um humano conectado; a sala some quando o último humano sai.
 * Nada é persistido: reiniciar o servidor derruba as salas.
 */
@Injectable()
export class BotaoRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(BOTAO_PUBLISHER) private readonly publisher: BotaoPublisher,
    @Inject(BOTAO_CONFIG) private readonly config: BotaoConfig,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
    @Inject(DRAW_TIMER) private readonly timer: DrawTimer,
    private readonly arena: ArenaService,
  ) {}

  private now(): number {
    return (this.config.now ?? Date.now)();
  }

  private rand = (): number => this.random(0, 1_000_000) / 1_000_000;

  roomOf(userId: string): string | undefined {
    return this.userRoom.get(userId);
  }

  create(
    player: BotaoPlayer,
    socketId: string,
    isPublic = true,
  ): BotaoSnapshot {
    this.assertFree(player.userId);
    if (this.rooms.size >= this.config.maxRooms)
      throw new DomainError(
        'INVALID_STATE',
        'Muitas salas abertas agora. Tente daqui a pouco',
      );
    let code: string;
    do code = generateRoomCode(this.random);
    while (this.rooms.has(code));
    const room: Room = {
      code,
      hostId: player.userId,
      isPublic,
      stake: minStake('BOTAO'),
      rules: { ...DEFAULT_BOTAO_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: BOTAO_SEATS }, () => null),
      match: null,
      lastFrame: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      tickTimer: undefined,
      botCount: 0,
    };
    room.seats[0] = this.newSeat(player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: BotaoPlayer, socketId: string): BotaoSnapshot {
    const current = this.userRoom.get(player.userId);
    if (current && current !== code) this.assertFree(player.userId);
    const room = this.rooms.get(code);
    if (!room) throw new DomainError('NOT_FOUND', 'Sala não encontrada');

    const seat = this.seatOf(room, player.userId);
    const out: Announcement[] = [];
    if (seat !== null) {
      // Mesmo usuário de novo (reconexão ou outra aba): nunca um segundo lugar.
      const state = room.seats[seat]!;
      state.sockets.add(socketId);
      if (state.reconnectDeadline !== null) {
        this.timer.clear(state.expiryTimer);
        state.reconnectDeadline = null;
        state.expiryTimer = undefined;
        out.push({ event: 'botao:player_reconnected', payload: { seat } });
      }
    } else {
      if (room.phase !== 'LOBBY')
        throw new DomainError(
          'GAME_IN_PROGRESS',
          'A partida já começou nessa sala',
        );
      const free = this.freeSeat(room, this.smallerTeam(room));
      if (free === null)
        throw new DomainError('ROOM_FULL', 'A sala está cheia');
      room.seats[free] = this.newSeat(player, socketId);
      this.userRoom.set(player.userId, code);
      out.push({
        event: 'botao:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Salas públicas que ainda aceitam gente (no lobby, com lugar), as mais cheias primeiro. */
  listPublic(): BotaoPublicRoom[] {
    const out: BotaoPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const total = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase !== 'LOBBY' || total >= BOTAO_SEATS)
        continue;
      const host = room.seats.find((s) => s?.userId === room.hostId)!;
      out.push({
        code: room.code,
        hostNickname: host.nickname,
        hostCharacter: host.character,
        stake: room.stake,
        players: [this.countTeam(room, 0), this.countTeam(room, 1)],
        rules: { ...room.rules },
      });
    }
    return out.sort(
      (a, b) => b.players[0] + b.players[1] - a.players[0] - a.players[1],
    );
  }

  /** Aposta da próxima partida; só no lobby. Com valor novo, todo mundo confirma de novo. */
  setStake(userId: string, stake: number): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda a aposta');
    if (!stakeLevel('BOTAO', stake))
      throw new DomainError(
        'INVALID_PAYLOAD',
        'Aposta inválida para este jogo',
      );
    if (room.stake === stake) return;
    room.stake = stake;
    for (const s of room.seats) if (s && !s.bot) s.ready = false;
    this.publish(room, []);
  }

  /** Aposta que quem chega precisa cobrir; null = já tem lugar aqui (reconexão) ou a mesa não existe. */
  stakeToJoin(code: string, userId: string): number | null {
    const room = this.rooms.get(code);
    if (!room || this.seatOf(room, userId) !== null) return null;
    return room.stake;
  }

  /** Quem aposta se a partida começar agora: os humanos sentados (com CPU não vale nada). */
  stakeCheck(userId: string): { stake: number; userIds: string[] } {
    const room = this.requireRoom(userId);
    if (room.seats.some((s) => s?.bot))
      return { stake: room.stake, userIds: [] };
    const userIds = room.seats.flatMap((s) => (s && !s.bot ? [s.userId] : []));
    return { stake: room.stake, userIds: userIds.length >= 2 ? userIds : [] };
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  setRules(userId: string, rules: BotaoRules): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda as regras');
    this.requirePhase(room, 'LOBBY');
    room.rules = { ...rules };
    this.publish(room, []);
  }

  /** Vai para o primeiro lugar livre do outro time. */
  setTeam(userId: string, team: number): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    const seat = this.seatOf(room, userId)!;
    if (botaoTeamOf(seat) === team) return;
    const free = this.freeSeat(room, team);
    if (free === null)
      throw new DomainError('ROOM_FULL', 'Esse time está completo');
    room.seats[free] = room.seats[seat];
    room.seats[seat] = null;
    this.publish(room, []);
  }

  addBot(userId: string, team?: number): void {
    const room = this.requireHost(userId, 'Só o anfitrião chama a CPU');
    this.requirePhase(room, 'LOBBY');
    const free = this.freeSeat(room, team ?? this.smallerTeam(room));
    if (free === null)
      throw new DomainError(
        'ROOM_FULL',
        team === undefined ? 'A sala está cheia' : 'Esse time está completo',
      );
    room.botCount++;
    room.seats[free] = {
      userId: `cpu:${room.botCount}`,
      nickname: `CPU ${room.seats.filter((s) => s?.bot).length + 1}`,
      character: null,
      bot: true,
      ready: true,
      sockets: new Set(),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
    this.publish(room, [
      {
        event: 'botao:player_joined',
        payload: { player: this.seatView(room, free)! },
      },
    ]);
  }

  removeBot(userId: string, seat: number): void {
    const room = this.requireHost(userId, 'Só o anfitrião tira a CPU');
    this.requirePhase(room, 'LOBBY');
    const bot = room.seats[seat];
    if (!bot?.bot)
      throw new DomainError('INVALID_STATE', 'Esse lugar não é da CPU');
    room.seats[seat] = null;
    this.publish(room, [
      {
        event: 'botao:player_left',
        payload: { seat, userId: bot.userId, reason: 'removed' },
      },
    ]);
  }

  sync(userId: string): BotaoSnapshot {
    return this.snapshot(this.requireRoom(userId), userId);
  }

  leave(userId: string): string {
    const room = this.requireRoom(userId);
    this.removePlayer(room, userId, 'left');
    return room.code;
  }

  /** Um socket fechou. Só o último socket do usuário abre a janela de reconexão. */
  disconnect(userId: string, socketId: string): void {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) return;
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    if (!state.sockets.delete(socketId) || state.sockets.size > 0) return;
    state.reconnectDeadline = this.now() + this.config.reconnectGraceMs;
    state.expiryTimer = this.timer.set(() => {
      if (this.rooms.get(room.code) !== room) return;
      if (this.seatOf(room, userId) === null) return;
      this.removePlayer(room, userId, 'expired');
    }, this.config.reconnectGraceMs);
    this.ensureConnectedHost(room);
    this.publish(room, [
      {
        event: 'botao:player_disconnected',
        payload: { seat, reconnectDeadline: state.reconnectDeadline },
      },
    ]);
  }

  setReady(userId: string, ready: boolean): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    room.seats[this.seatOf(room, userId)!]!.ready = ready;
    this.publish(room, []);
  }

  start(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião inicia a partida');
    if (this.countTeam(room, 0) === 0 || this.countTeam(room, 1) === 0)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'Cada time precisa de pelo menos 1 jogador (chame a CPU)',
      );
    const seated = room.seats.filter((s): s is SeatState => s !== null);
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    room.phase = 'PLAYING';
    room.result = null;
    room.tracker = new MatchTracker(
      room.seats.flatMap((s, i) =>
        s && !s.bot ? [{ seat: i, userId: s.userId }] : [],
      ),
      this.now(),
      room.seats.filter((s) => s?.bot).length,
    );
    const match = new BotaoMatch(
      room.seats.flatMap((s, seat) => (s ? [{ seat, bot: s.bot }] : [])),
      room.rules,
      this.rand,
    );
    room.match = match;
    room.lastFrame = match.frame();
    this.publish(room, [{ event: 'botao:match_started', payload: {} }]);
    this.publisher.frame(room.code, room.lastFrame);
    this.scheduleTick(room, match);
  }

  /** De volta ao lobby com os mesmos lugares; todo mundo confirma de novo. */
  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.lastFrame = null;
    room.result = null;
    for (const s of room.seats) if (s && !s.bot) s.ready = false;
    this.publish(room, []);
  }

  /** Movimento e chute do próximo tick; ignorado fora da partida. */
  input(userId: string, input: BotaoInput): void {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room?.match || room.phase !== 'PLAYING') return;
    room.match.pushInput(this.seatOf(room, userId)!, input);
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  private scheduleTick(room: Room, match: BotaoMatch): void {
    room.tickTimer = this.timer.set(() => {
      room.tickTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      this.tick(room, match);
    }, BOTAO_TICK_MS);
  }

  private tick(room: Room, match: BotaoMatch): void {
    match.tick();
    room.lastFrame = match.frame();
    this.publisher.frame(room.code, room.lastFrame);
    const goals = match.drainGoals();
    if (goals.length)
      this.publish(
        room,
        goals.map((goal) => ({
          event: 'botao:goal' as const,
          payload: { goal, score: [...match.score] as [number, number] },
        })),
      );
    if (match.result) this.finish(room, match, []);
    else this.scheduleTick(room, match);
  }

  private finish(room: Room, match: BotaoMatch, out: Announcement[]): void {
    this.timer.clear(room.tickTimer);
    room.tickTimer = undefined;
    room.phase = 'FINISHED';
    room.result = {
      winner: match.result!.winner,
      score: [match.score[0], match.score[1]],
      goals: [...match.goals],
      walkover: match.result!.walkover,
    };
    out.push({ event: 'botao:match_over', payload: { ...room.result } });
    this.settle(room, room.result.winner);
    this.publish(room, out);
  }

  /** Moedas e ranking: o time campeão divide o pote; o outro fica em 2º. */
  private settle(room: Room, winner: number): void {
    const tracker = room.tracker;
    room.tracker = null;
    if (!tracker) return;
    const seats = tracker.seatList();
    const placeOf = rankSeats(
      seats,
      (seat) => (botaoTeamOf(seat) === winner ? 1 : 0),
      new Set(seats.filter((s) => botaoTeamOf(s) === winner)),
    );
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'BOTAO',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants(placeOf),
      cpuPlayers: tracker.cpuPlayers,
    });
  }

  private removePlayer(
    room: Room,
    userId: string,
    reason: BotaoLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    if (room.phase === 'PLAYING') room.tracker?.markLeft(seat);
    room.match?.remove(seat);

    if (!room.seats.some((s) => s && !s.bot)) {
      this.clearTimers(room);
      this.rooms.delete(room.code);
      this.publisher.publicRoomsChanged(() => this.listPublic());
      return;
    }
    if (room.hostId === userId) {
      const humans = room.seats.filter((s): s is SeatState => !!s && !s.bot);
      room.hostId = (
        humans.find((s) => s.sockets.size > 0) ?? humans[0]
      ).userId;
    }
    const out: Announcement[] = [
      { event: 'botao:player_left', payload: { seat, userId, reason } },
    ];
    // Time vazio no meio da partida: o outro leva por W.O. na hora.
    if (room.phase === 'PLAYING' && room.match?.result) {
      room.lastFrame = room.match.frame();
      this.publisher.frame(room.code, room.lastFrame);
      this.finish(room, room.match, out);
      return;
    }
    this.publish(room, out);
  }

  /** Mantém o anfitrião com um humano que consegue apertar "iniciar". */
  private ensureConnectedHost(room: Room): void {
    const host = room.seats.find((s) => s?.userId === room.hostId);
    if (host && host.sockets.size > 0) return;
    const next = room.seats.find((s) => s && !s.bot && s.sockets.size > 0);
    if (next) room.hostId = next.userId;
  }

  /** Anúncios primeiro (com seq), depois o estado da sala. */
  private publish(room: Room, out: Announcement[]): void {
    for (const a of out)
      this.publisher.toRoom(room.code, a.event, {
        seq: ++room.seq,
        ...a.payload,
      });
    room.version++;
    this.publisher.publicRoomsChanged(() => this.listPublic());
    this.publisher.toRoom(
      room.code,
      BotaoServerEvents.STATE,
      this.publicState(room),
    );
  }

  private publicState(room: Room): BotaoRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      this.countTeam(room, 0) > 0 &&
      this.countTeam(room, 1) > 0 &&
      seated.every((s) => s.ready && s.reconnectDeadline === null);
    const match = room.match;
    return {
      code: room.code,
      version: room.version,
      hostId: room.hostId,
      isPublic: room.isPublic,
      stake: room.stake,
      rules: { ...room.rules },
      phase: room.phase,
      lobbyStatus:
        room.phase === 'LOBBY'
          ? ready
            ? 'READY_TO_START'
            : 'WAITING_PLAYERS'
          : null,
      seats: room.seats.map((_, i) => this.seatView(room, i)),
      score: match ? [match.score[0], match.score[1]] : [0, 0],
      goals: match ? [...match.goals] : [],
      result: room.result,
    };
  }

  private seatView(room: Room, seat: number): BotaoSeatPlayer | null {
    const s = room.seats[seat];
    if (!s) return null;
    return {
      seat,
      userId: s.userId,
      nickname: s.nickname,
      character: s.character,
      bot: s.bot,
      ready: s.ready,
      connected: s.reconnectDeadline === null,
      reconnectDeadline: s.reconnectDeadline,
    };
  }

  private snapshot(room: Room, userId: string): BotaoSnapshot {
    return {
      state: this.publicState(room),
      mySeat: this.seatOf(room, userId)!,
      frame:
        room.phase === 'PLAYING' && room.lastFrame
          ? { ...room.lastFrame, events: [] }
          : null,
    };
  }

  private newSeat(player: BotaoPlayer, socketId: string): SeatState {
    return {
      ...player,
      bot: false,
      ready: false,
      sockets: new Set([socketId]),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
  }

  private countTeam(room: Room, team: number): number {
    return teamSeats(team).filter((i) => room.seats[i] !== null).length;
  }

  /** Time com menos gente (empate: vermelho). */
  private smallerTeam(room: Room): number {
    return this.countTeam(room, 1) < this.countTeam(room, 0) ? 1 : 0;
  }

  /** Primeiro lugar livre do time, ou null se estiver completo. */
  private freeSeat(room: Room, team: number): number | null {
    const free = teamSeats(team).find((i) => room.seats[i] === null);
    return free ?? null;
  }

  private seatOf(room: Room, userId: string): number | null {
    const i = room.seats.findIndex((s) => s?.userId === userId);
    return i < 0 ? null : i;
  }

  private assertFree(userId: string): void {
    const code = this.userRoom.get(userId);
    if (code)
      throw new DomainError(
        'INVALID_STATE',
        `Você já está na sala ${code}. Saia dela antes`,
      );
  }

  private requireRoom(userId: string): Room {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room)
      throw new DomainError('NOT_IN_ROOM', 'Você não está em uma sala');
    return room;
  }

  private requireHost(userId: string, message: string): Room {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new DomainError('NOT_HOST', message);
    return room;
  }

  private requirePhase(room: Room, phase: BotaoRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.tickTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
