import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  TACADA_SEATS,
  DEFAULT_TACADA_RULES,
  TacadaServerEvents,
  TACADA_READY_SLACK_MS,
  minStake,
  stakeLevel,
  type TacadaEmote,
  type TacadaLeftReason,
  type TacadaAim,
  type TacadaMatchResult,
  type TacadaPublicRoom,
  type TacadaRoomPhase,
  type TacadaRoomState,
  type TacadaRules,
  type TacadaSeatPlayer,
  type TacadaSnapshot,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { CPU_THINK_MS, cpuNickname, cpuUserId } from '../arena/cpu';
import { MatchTracker } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import {
  TacadaMatch,
  type Announcement,
  type TacadaShotInput,
} from './engine/match';
import { tacadaBotTurn } from './engine/bot';
import { TACADA_PUBLISHER, type TacadaPublisher } from './tacada-publisher';

export interface TacadaConfig {
  /** How long a disconnected player's seat stays reserved. */
  reconnectGraceMs: number;
  /** Upper bound of rooms kept in memory. */
  maxRooms: number;
  /** Clock used for deadlines (injectable for tests). */
  now?: () => number;
}
export const TACADA_CONFIG = Symbol('TACADA_CONFIG');

/** Identity comes from the verified token; nickname/character come from the stored profile. */
export interface TacadaPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends TacadaPlayer {
  /** CPU: joga sozinha, nunca segura a mesa aberta e não entra na Arena. */
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
  rules: TacadaRules;
  phase: TacadaRoomPhase;
  seats: (SeatState | null)[];
  /** Seat that breaks; swaps on every rematch. */
  breakerSeat: number;
  match: TacadaMatch | null;
  result: TacadaMatchResult | null;
  /** Quem sentou e quem saiu, para a Arena pagar moedas e pontos no fim. */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  turnTimer: unknown;
  /** Turn token the running turn timer belongs to. */
  turnToken: number | null;
  turnDeadline: number | null;
  /** Epoch ms when the last shot's animation ends. */
  readyAt: number;
  botCount: number;
  botTimer: unknown;
  /** Turn token the scheduled CPU shot belongs to. */
  botToken: number | null;
}

/**
 * Authoritative in-memory Tacada (8-ball) tables (two seats each). Every method is
 * synchronous, so two events can never interleave inside one room.
 *
 * Policy:
 * - one table per user; a user always gets back the same seat;
 * - every shot has a deadline (rules.shotSeconds, counted after the previous
 *   shot's animation); running out is a foul (ball in hand for the other);
 * - a disconnected player keeps the seat for `reconnectGraceMs` (the clock
 *   keeps running). Then, or when leaving mid-match, the other player wins;
 * - the host role moves to a connected player when the host goes offline or leaves;
 * - the break alternates on every rematch; the room is deleted when it gets empty.
 * State is not persisted: a server restart drops every table.
 */
@Injectable()
export class TacadaRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(TACADA_PUBLISHER) private readonly publisher: TacadaPublisher,
    @Inject(TACADA_CONFIG) private readonly config: TacadaConfig,
    @Inject(RANDOM_INT) private readonly random: RandomInt,
    @Inject(DRAW_TIMER) private readonly timer: DrawTimer,
    private readonly arena: ArenaService,
  ) {}

  private now(): number {
    return (this.config.now ?? Date.now)();
  }

  roomOf(userId: string): string | undefined {
    return this.userRoom.get(userId);
  }

  create(
    player: TacadaPlayer,
    socketId: string,
    isPublic = true,
  ): TacadaSnapshot {
    this.assertFree(player.userId);
    if (this.rooms.size >= this.config.maxRooms)
      throw new DomainError(
        'INVALID_STATE',
        'Muitas mesas abertas agora. Tente daqui a pouco',
      );
    let code: string;
    do code = generateRoomCode(this.random);
    while (this.rooms.has(code));
    const room: Room = {
      code,
      hostId: player.userId,
      isPublic,
      stake: minStake('TACADA'),
      rules: { ...DEFAULT_TACADA_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: TACADA_SEATS }, () => null),
      breakerSeat: 0,
      match: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      turnTimer: undefined,
      turnToken: null,
      turnDeadline: null,
      readyAt: 0,
      botCount: 0,
      botTimer: undefined,
      botToken: null,
    };
    room.seats[0] = this.newSeat(player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: TacadaPlayer, socketId: string): TacadaSnapshot {
    const current = this.userRoom.get(player.userId);
    if (current && current !== code) this.assertFree(player.userId);
    const room = this.rooms.get(code);
    if (!room) throw new DomainError('NOT_FOUND', 'Mesa não encontrada');

    const seat = this.seatOf(room, player.userId);
    const out: Announcement[] = [];
    if (seat !== null) {
      // Same user again (reconnection or another tab): never a second seat.
      const state = room.seats[seat]!;
      state.sockets.add(socketId);
      if (state.reconnectDeadline !== null) {
        this.timer.clear(state.expiryTimer);
        state.reconnectDeadline = null;
        state.expiryTimer = undefined;
        out.push({ event: 'tacada:player_reconnected', payload: { seat } });
      }
    } else {
      if (room.phase === 'PLAYING')
        throw new DomainError(
          'GAME_IN_PROGRESS',
          'A partida já começou nessa mesa',
        );
      const free = room.seats.findIndex((s) => s === null);
      if (free < 0) throw new DomainError('ROOM_FULL', 'A mesa está cheia');
      room.seats[free] = this.newSeat(player, socketId);
      this.userRoom.set(player.userId, code);
      out.push({
        event: 'tacada:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public tables waiting for an opponent. */
  listPublic(): TacadaPublicRoom[] {
    const out: TacadaPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase === 'PLAYING' || players >= TACADA_SEATS)
        continue;
      const host = room.seats.find((s) => s?.userId === room.hostId)!;
      out.push({
        code: room.code,
        hostNickname: host.nickname,
        hostCharacter: host.character,
        stake: room.stake,
        players,
        rules: { ...room.rules },
      });
    }
    return out;
  }

  /** Aposta da próxima partida; só no lobby. Com valor novo, todo mundo confirma de novo. */
  setStake(userId: string, stake: number): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda a aposta');
    if (!stakeLevel('TACADA', stake))
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

  /** Quem aposta se a partida começar agora: os dois sentados. */
  stakeCheck(userId: string): { stake: number; userIds: string[] } {
    const room = this.requireRoom(userId);
    if (room.seats.some((s) => s?.bot))
      return { stake: room.stake, userIds: [] };
    const userIds = room.seats.flatMap((s) => (s ? [s.userId] : []));
    return { stake: room.stake, userIds: userIds.length >= 2 ? userIds : [] };
  }

  /** O anfitrião completa a mesa com uma CPU (sempre pronta). */
  addBot(userId: string): void {
    const room = this.requireHost(userId, 'Só o anfitrião chama a CPU');
    this.requirePhase(room, 'LOBBY');
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) throw new DomainError('ROOM_FULL', 'A mesa está cheia');
    room.botCount++;
    room.seats[free] = {
      userId: cpuUserId(room.botCount),
      nickname: cpuNickname(room.seats.filter((s) => s?.bot).length),
      character: null,
      bot: true,
      ready: true,
      sockets: new Set(),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
    this.publish(room, [
      {
        event: 'tacada:player_joined',
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
        event: 'tacada:player_left',
        payload: { seat, userId: bot.userId, reason: 'removed' },
      },
    ]);
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  setRules(userId: string, rules: TacadaRules): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda as regras');
    this.requirePhase(room, 'LOBBY');
    room.rules = { ...rules };
    this.publish(room, []);
  }

  sync(userId: string): TacadaSnapshot {
    return this.snapshot(this.requireRoom(userId), userId);
  }

  leave(userId: string): string {
    const room = this.requireRoom(userId);
    this.removePlayer(room, userId, 'left');
    return room.code;
  }

  /** A socket closed. Only the last socket of the user starts the reconnection window. */
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
        event: 'tacada:player_disconnected',
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
    const seated = room.seats.filter((s): s is SeatState => s !== null);
    if (seated.length < TACADA_SEATS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'A Tacada precisa de 2 jogadores',
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    const breaker = room.breakerSeat;
    room.match = new TacadaMatch(this.random, [breaker, 1 - breaker]);
    room.readyAt = this.now();
    room.phase = 'PLAYING';
    room.result = null;
    room.tracker = new MatchTracker(
      seated
        .filter((s) => !s.bot)
        .map((s) => ({ seat: room.seats.indexOf(s), userId: s.userId })),
      this.now(),
      seated.filter((s) => s.bot).length,
    );
    this.afterMatchChange(room, [
      { event: 'tacada:match_started', payload: { breakerSeat: breaker } },
    ]);
  }

  /** Back to the lobby; the other player breaks next. */
  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.result = null;
    room.breakerSeat = 1 - room.breakerSeat;
    for (const s of room.seats) if (s && !s.bot) s.ready = false;
    this.publish(room, []);
  }

  shoot(userId: string, input: TacadaShotInput): void {
    const room = this.requireRoom(userId);
    if (
      room.phase === 'PLAYING' &&
      this.now() < room.readyAt - TACADA_READY_SLACK_MS
    )
      throw new DomainError('INVALID_STATE', 'Espere as bolas pararem');
    this.matchAction(userId, (m, seat) => m.shoot(seat, input));
  }

  resign(userId: string): void {
    this.matchAction(userId, (m, seat) => m.resign(seat));
  }

  /**
   * Live aim of whoever is shooting, to show to the other player.
   * Returns where to relay it, or null when it must be dropped (not their turn, balls rolling).
   */
  aim(
    userId: string,
    aim: Omit<TacadaAim, 'seat'>,
  ): { code: string; aim: TacadaAim } | null {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room || room.phase !== 'PLAYING' || !room.match) return null;
    const seat = this.seatOf(room, userId);
    if (seat === null || room.match.turnSeat !== seat) return null;
    if (this.now() < room.readyAt - TACADA_READY_SLACK_MS) return null;
    return { code: room.code, aim: { ...aim, seat } };
  }

  /** Quick reaction shown to the whole table. */
  emote(userId: string, emote: TacadaEmote): void {
    const room = this.requireRoom(userId);
    this.publisher.toRoom(room.code, TacadaServerEvents.EMOTED, {
      seat: this.seatOf(room, userId)!,
      emote,
    });
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  private matchAction(
    userId: string,
    fn: (match: TacadaMatch, seat: number) => Announcement[],
  ): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'PLAYING');
    const out = fn(room.match!, this.seatOf(room, userId)!);
    this.afterMatchChange(room, out);
  }

  /** Ends the match or restarts the turn clock, then publishes. */
  private afterMatchChange(room: Room, out: Announcement[]): void {
    const match = room.match!;
    if (match.phase === 'OVER') {
      this.stopTurnClock(room);
      room.readyAt = this.now() + match.animationMs;
      room.phase = 'FINISHED';
      room.result = { ...match.result! };
      out.push({ event: 'tacada:match_over', payload: { ...room.result } });
      this.settle(room);
    } else if (room.turnToken !== match.turnToken) {
      this.startTurnClock(room, match);
    }
    this.publish(room, out);
    this.driveBot(room, match);
  }

  /** Vez da CPU: espera as bolas pararem, "mira" um pouco e taca. */
  private driveBot(room: Room, match: TacadaMatch): void {
    if (match.phase !== 'PLAYING' || !room.seats[match.turnSeat]?.bot) return;
    const token = match.turnToken;
    if (room.botToken === token) return;
    this.timer.clear(room.botTimer);
    room.botToken = token;
    const wait = Math.max(0, room.readyAt - this.now()) + CPU_THINK_MS * 2;
    room.botTimer = this.timer.set(() => {
      room.botTimer = undefined;
      room.botToken = null;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      if (match.phase !== 'PLAYING' || match.turnToken !== token) return;
      let out: Announcement[];
      try {
        out = tacadaBotTurn(match, match.turnSeat, this.random);
      } catch {
        out = match.timeout();
      }
      this.afterMatchChange(room, out);
    }, wait);
  }

  /**
   * Moedas e ranking: o vencedor leva o pote (bilhar não tem empate).
   */
  private settle(room: Room): void {
    const tracker = room.tracker;
    room.tracker = null;
    const winner = room.result?.winner ?? null;
    if (!tracker || winner === null) return;
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'TACADA',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants((seat) => (seat === winner ? 1 : 2)),
      cpuPlayers: tracker.cpuPlayers,
    });
  }

  private startTurnClock(room: Room, match: TacadaMatch): void {
    this.timer.clear(room.turnTimer);
    const token = match.turnToken;
    // The clock only runs after the balls stop rolling.
    const anim = match.animationMs;
    const ms = anim + room.rules.shotSeconds * 1000;
    room.turnToken = token;
    room.readyAt = this.now() + anim;
    room.turnDeadline = this.now() + ms;
    room.turnTimer = this.timer.set(() => {
      room.turnTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      if (match.phase !== 'PLAYING' || match.turnToken !== token) return;
      this.afterMatchChange(room, match.timeout());
    }, ms);
  }

  private stopTurnClock(room: Room): void {
    this.timer.clear(room.turnTimer);
    room.turnTimer = undefined;
    room.turnToken = null;
    room.turnDeadline = null;
  }

  private removePlayer(
    room: Room,
    userId: string,
    reason: TacadaLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    const out: Announcement[] = [
      { event: 'tacada:player_left', payload: { seat, userId, reason } },
    ];

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
    if (room.phase === 'PLAYING' && room.match) {
      // Leaving (or not coming back) mid-match hands the win to the other player.
      room.tracker?.markLeft(seat);
      out.push(...room.match.removePlayer(seat));
      this.afterMatchChange(room, out);
      return;
    }
    this.publish(room, out);
  }

  /** Keeps the host role with someone who can press "start". */
  private ensureConnectedHost(room: Room): void {
    const host = room.seats.find((s) => s?.userId === room.hostId);
    if (host && host.sockets.size > 0) return;
    const next = room.seats.find((s) => s && s.sockets.size > 0);
    if (next) room.hostId = next.userId;
  }

  /** Announcements first (with their seq), then the public state. */
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
      TacadaServerEvents.STATE,
      this.publicState(room),
    );
  }

  private publicState(room: Room): TacadaRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length === TACADA_SEATS &&
      seated.every((s) => s.ready && s.reconnectDeadline === null);
    const inMatch = room.match && room.phase !== 'LOBBY' ? room.match : null;
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
      breakerSeat: room.breakerSeat,
      game: inMatch
        ? {
            ...inMatch.publicView(),
            turnDeadline: room.turnDeadline,
            readyAt: room.readyAt,
          }
        : null,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: number): TacadaSeatPlayer | null {
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

  private snapshot(room: Room, userId: string): TacadaSnapshot {
    return {
      state: this.publicState(room),
      mySeat: this.seatOf(room, userId)!,
    };
  }

  private newSeat(player: TacadaPlayer, socketId: string): SeatState {
    return {
      ...player,
      bot: false,
      ready: false,
      sockets: new Set([socketId]),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
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
        `Você já está na mesa ${code}. Saia dela antes`,
      );
  }

  private requireRoom(userId: string): Room {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room)
      throw new DomainError('NOT_IN_ROOM', 'Você não está em uma mesa');
    return room;
  }

  private requireHost(userId: string, message: string): Room {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new DomainError('NOT_HOST', message);
    return room;
  }

  private requirePhase(room: Room, phase: TacadaRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.turnTimer);
    this.timer.clear(room.botTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
