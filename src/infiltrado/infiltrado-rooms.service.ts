import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DEFAULT_INF_RULES,
  INF_COLORS,
  INF_MIN_PLAYERS,
  INF_SEATS,
  INF_TICK_MS,
  InfServerEvents,
  infMaxImpostors,
  type InfAct,
  type InfInput,
  type InfLeftReason,
  type InfMatchResult,
  type InfPublicRoom,
  type InfRoomPhase,
  type InfRoomState,
  type InfRules,
  type InfSeatPlayer,
  type InfServerEventName,
  type InfServerEventPayloads,
  type InfSnapshot,
  minStake,
  stakeLevel,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker, rankSeats } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { InfMatch } from './engine/match';
import { INF_PUBLISHER, type InfPublisher } from './infiltrado-publisher';

export interface InfConfig {
  /** How long a disconnected player's seat stays reserved. */
  reconnectGraceMs: number;
  /** Upper bound of rooms kept in memory. */
  maxRooms: number;
  now?: () => number;
}
export const INF_CONFIG = Symbol('INF_CONFIG');

/** Out of the action (meetings, intro, ejection) frames go out at this fraction of the tick rate. */
const SLOW_FRAME_EVERY = 4;

export interface InfPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends InfPlayer {
  bot: boolean;
  color: number;
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
  rules: InfRules;
  phase: InfRoomPhase;
  seats: (SeatState | null)[];
  match: InfMatch | null;
  result: InfMatchResult | null;
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  ticks: number;
  tickTimer: unknown;
  botCount: number;
}

type Announcement = {
  [E in InfServerEventName]: {
    event: E;
    payload: Omit<InfServerEventPayloads[E], 'seq'>;
  };
}[InfServerEventName];

/**
 * Authoritative in-memory Infiltrado rooms (same policy as the Bomber rooms):
 * one room per user, the seat survives a reconnection window, CPUs never keep a
 * room alive, the host role moves to a connected human. During a match every
 * player gets a private frame with only what they can see; roles only become
 * public when the match is over.
 */
@Injectable()
export class InfRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();
  private readonly voiceListeners = new Set<(code: string) => void>();

  constructor(
    @Inject(INF_PUBLISHER) private readonly publisher: InfPublisher,
    @Inject(INF_CONFIG) private readonly config: InfConfig,
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

  /** Voice is only for meetings, and only for who could vote in them (ghosts stay silent). */
  canTalk(code: string, userId: string): boolean {
    const room = this.rooms.get(code);
    const meeting = room?.match?.meeting;
    if (
      !room ||
      room.phase !== 'PLAYING' ||
      room.match?.phase !== 'meeting' ||
      !meeting
    )
      return false;
    const seat = this.seatOf(room, userId);
    return seat !== null && meeting.voters.includes(seat);
  }

  /** Called with the room code whenever who may talk changes (a meeting opens or closes). */
  onVoiceRightsChanged(fn: (code: string) => void): () => void {
    this.voiceListeners.add(fn);
    return () => this.voiceListeners.delete(fn);
  }

  private voiceChanged(code: string): void {
    for (const fn of this.voiceListeners) fn(code);
  }

  create(player: InfPlayer, socketId: string, isPublic = true): InfSnapshot {
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
      stake: minStake('INFILTRADO'),
      rules: { ...DEFAULT_INF_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: INF_SEATS }, () => null),
      match: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      ticks: 0,
      tickTimer: undefined,
      botCount: 0,
    };
    room.seats[0] = this.newSeat(room, player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: InfPlayer, socketId: string): InfSnapshot {
    const current = this.userRoom.get(player.userId);
    if (current && current !== code) this.assertFree(player.userId);
    const room = this.rooms.get(code);
    if (!room) throw new DomainError('NOT_FOUND', 'Sala não encontrada');

    const seat = this.seatOf(room, player.userId);
    const out: Announcement[] = [];
    if (seat !== null) {
      const state = room.seats[seat]!;
      state.sockets.add(socketId);
      if (state.reconnectDeadline !== null) {
        this.timer.clear(state.expiryTimer);
        state.reconnectDeadline = null;
        state.expiryTimer = undefined;
        out.push({ event: 'inf:player_reconnected', payload: { seat } });
      }
    } else {
      if (room.phase !== 'LOBBY')
        throw new DomainError(
          'GAME_IN_PROGRESS',
          'A partida já começou nessa sala',
        );
      const free = room.seats.findIndex((s) => s === null);
      if (free < 0) throw new DomainError('ROOM_FULL', 'A sala está cheia');
      room.seats[free] = this.newSeat(room, player, socketId);
      this.userRoom.set(player.userId, code);
      out.push({
        event: 'inf:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public rooms that can still be joined (in the lobby, a seat free), fullest first. */
  listPublic(): InfPublicRoom[] {
    const out: InfPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase !== 'LOBBY' || players >= INF_SEATS)
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
    return out.sort((a, b) => b.players - a.players);
  }

  /** Aposta da próxima partida; só no lobby. Com valor novo, todo mundo confirma de novo. */
  setStake(userId: string, stake: number): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda a aposta');
    if (!stakeLevel('INFILTRADO', stake))
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

  /** Quem aposta se a partida começar agora: os humanos sentados (sozinho contra CPU não vale nada). */
  stakeCheck(userId: string): { stake: number; userIds: string[] } {
    const room = this.requireRoom(userId);
    const userIds = room.seats.flatMap((s) => (s && !s.bot ? [s.userId] : []));
    return { stake: room.stake, userIds: userIds.length >= 2 ? userIds : [] };
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  setRules(userId: string, rules: InfRules): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda as regras');
    this.requirePhase(room, 'LOBBY');
    room.rules = { ...rules };
    this.publish(room, []);
  }

  setColor(userId: string, color: number): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    const me = room.seats[this.seatOf(room, userId)!]!;
    if (me.color === color) return;
    if (room.seats.some((s) => s?.color === color))
      throw new DomainError('INVALID_STATE', 'Essa cor já foi escolhida');
    me.color = color;
    this.publish(room, []);
  }

  addBot(userId: string): void {
    const room = this.requireHost(userId, 'Só o anfitrião chama a CPU');
    this.requirePhase(room, 'LOBBY');
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) throw new DomainError('ROOM_FULL', 'A sala está cheia');
    room.botCount++;
    room.seats[free] = {
      userId: `cpu:${room.botCount}`,
      nickname: `CPU ${room.seats.filter((s) => s?.bot).length + 1}`,
      character: null,
      bot: true,
      color: this.freeColor(room),
      ready: true,
      sockets: new Set(),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
    this.publish(room, [
      {
        event: 'inf:player_joined',
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
        event: 'inf:player_left',
        payload: { seat, userId: bot.userId, reason: 'removed' },
      },
    ]);
  }

  sync(userId: string): InfSnapshot {
    return this.snapshot(this.requireRoom(userId), userId);
  }

  leave(userId: string): string {
    const room = this.requireRoom(userId);
    this.removePlayer(room, userId, 'left');
    return room.code;
  }

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
        event: 'inf:player_disconnected',
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
    if (seated.length < INF_MIN_PLAYERS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        `Precisa de pelo menos ${INF_MIN_PLAYERS} jogadores (chame a CPU)`,
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    room.phase = 'PLAYING';
    room.result = null;
    room.ticks = 0;
    room.tracker = new MatchTracker(
      room.seats.flatMap((s, i) =>
        s && !s.bot ? [{ seat: i, userId: s.userId }] : [],
      ),
      this.now(),
    );
    const impostors = Math.min(
      room.rules.impostors,
      infMaxImpostors(seated.length),
    );
    room.match = new InfMatch(
      room.seats.flatMap((s, seat) => (s ? [{ seat, bot: s.bot }] : [])),
      room.rules,
      impostors,
      this.rand,
    );
    this.publish(room, [{ event: 'inf:match_started', payload: {} }]);
    this.sendFrames(room);
    this.scheduleTick(room, room.match);
  }

  /** Back to the lobby with the same seats; everybody confirms again. */
  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.result = null;
    for (const s of room.seats) if (s && !s.bot) s.ready = false;
    this.publish(room, []);
  }

  input(userId: string, input: InfInput): void {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room?.match || room.phase !== 'PLAYING') return;
    room.match.pushInput(this.seatOf(room, userId)!, input);
  }

  act(userId: string, action: InfAct): void {
    const room = this.requirePlaying(userId);
    const match = room.match!;
    const before = match.phase;
    match.act(this.seatOf(room, userId)!, action);
    if (match.phase !== before) this.voiceChanged(room.code);
    if (match.phase === 'over') this.finish(room);
  }

  chat(userId: string, text: string): void {
    const room = this.requirePlaying(userId);
    const match = room.match!;
    const { message } = match.say(this.seatOf(room, userId)!, text);
    room.seats.forEach((s, seat) => {
      if (!s || s.bot) return;
      const p = match.player(seat);
      if (message.ghost && p?.alive) return;
      this.publisher.chat(s.userId, message);
    });
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  private scheduleTick(room: Room, match: InfMatch): void {
    room.tickTimer = this.timer.set(() => {
      room.tickTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      this.tick(room, match);
    }, INF_TICK_MS);
  }

  private tick(room: Room, match: InfMatch): void {
    const before = match.phase;
    match.tick();
    room.ticks++;
    if (match.phase !== before) this.voiceChanged(room.code);
    if (match.phase === 'over') return this.finish(room);
    const fast = match.phase === 'play';
    if (fast || before !== match.phase || room.ticks % SLOW_FRAME_EVERY === 0)
      this.sendFrames(room);
    this.scheduleTick(room, match);
  }

  /** Each human gets their own view of the match. */
  private sendFrames(room: Room): void {
    const match = room.match;
    if (!match) return;
    room.seats.forEach((s, seat) => {
      if (!s || s.bot) return;
      // Nobody to send it to: just drop the events instead of building a frame.
      if (s.sockets.size === 0) return match.discardEvents(seat);
      this.publisher.frame(s.userId, match.frameFor(seat));
    });
  }

  private finish(room: Room): void {
    const match = room.match!;
    this.timer.clear(room.tickTimer);
    room.tickTimer = undefined;
    this.sendFrames(room);
    room.phase = 'FINISHED';
    room.result = {
      winner: match.result!.winner,
      reason: match.result!.reason,
      impostors: match.impostorSeats(),
    };
    this.settle(room);
    this.publish(room, [
      { event: 'inf:match_over', payload: { ...room.result } },
    ]);
  }

  /** Moedas e ranking: o time vencedor divide o pote; o outro fica em 2º. */
  private settle(room: Room): void {
    const tracker = room.tracker;
    room.tracker = null;
    const match = room.match;
    if (!tracker || !match || !room.result) return;
    const winners = new Set(
      tracker
        .seatList()
        .filter((seat) => match.player(seat)?.role === room.result!.winner),
    );
    const placeOf = rankSeats(tracker.seatList(), () => 0, winners);
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'INFILTRADO',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants(placeOf),
    });
  }

  private removePlayer(
    room: Room,
    userId: string,
    reason: InfLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    this.voiceChanged(room.code);
    if (room.phase === 'PLAYING') room.tracker?.markLeft(seat);

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
      { event: 'inf:player_left', payload: { seat, userId, reason } },
    ];
    if (room.phase === 'PLAYING' && room.match) {
      room.match.remove(seat);
      if (room.match.phase === 'over') {
        this.publish(room, out);
        this.finish(room);
        return;
      }
    }
    this.publish(room, out);
  }

  private ensureConnectedHost(room: Room): void {
    const host = room.seats.find((s) => s?.userId === room.hostId);
    if (host && host.sockets.size > 0) return;
    const next = room.seats.find((s) => s && !s.bot && s.sockets.size > 0);
    if (next) room.hostId = next.userId;
  }

  /** Announcements first (with their seq), then the room state. */
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
      InfServerEvents.STATE,
      this.publicState(room),
    );
  }

  private publicState(room: Room): InfRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length >= INF_MIN_PLAYERS &&
      seated.every((s) => s.ready && s.reconnectDeadline === null);
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
      result: room.result ? { ...room.result } : null,
    };
  }

  private seatView(room: Room, seat: number): InfSeatPlayer | null {
    const s = room.seats[seat];
    if (!s) return null;
    return {
      seat,
      userId: s.userId,
      nickname: s.nickname,
      character: s.character,
      color: s.color,
      bot: s.bot,
      ready: s.ready,
      connected: s.reconnectDeadline === null,
      reconnectDeadline: s.reconnectDeadline,
    };
  }

  private snapshot(room: Room, userId: string): InfSnapshot {
    const seat = this.seatOf(room, userId)!;
    const match = room.match;
    return {
      state: this.publicState(room),
      mySeat: seat,
      frame: match ? match.frameFor(seat) : null,
      chat: match ? match.chatFor(seat) : [],
    };
  }

  private newSeat(room: Room, player: InfPlayer, socketId: string): SeatState {
    return {
      ...player,
      bot: false,
      color: this.freeColor(room),
      ready: false,
      sockets: new Set([socketId]),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
  }

  /** First color nobody picked (there are as many colors as seats). */
  private freeColor(room: Room): number {
    const used = new Set(room.seats.map((s) => s?.color));
    return INF_COLORS.findIndex((_, i) => !used.has(i));
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

  private requirePlaying(userId: string): Room {
    const room = this.requireRoom(userId);
    if (room.phase !== 'PLAYING' || !room.match)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
    return room;
  }

  private requireHost(userId: string, message: string): Room {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId) throw new DomainError('NOT_HOST', message);
    return room;
  }

  private requirePhase(room: Room, phase: InfRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.tickTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
