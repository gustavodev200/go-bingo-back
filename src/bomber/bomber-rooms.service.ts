import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  BOMBER_COLORS,
  BOMBER_MIN_PLAYERS,
  BOMBER_SEATS,
  BOMBER_TICK_MS,
  BomberServerEvents,
  DEFAULT_BOMBER_RULES,
  type BomberFrame,
  type BomberInput,
  type BomberLeftReason,
  type BomberMatchResult,
  type BomberPublicRoom,
  type BomberRoomPhase,
  type BomberRoomState,
  type BomberRules,
  type BomberSeatPlayer,
  type BomberServerEventName,
  type BomberServerEventPayloads,
  type BomberSnapshot,
  minStake,
  stakeLevel,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker, rankSeats } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { BOMBER_PUBLISHER, type BomberPublisher } from './bomber-publisher';
import { BomberRound } from './engine/round';

export interface BomberConfig {
  /** How long a disconnected player's seat stays reserved. */
  reconnectGraceMs: number;
  /** Pause after a round so everybody sees who won before the next one. */
  roundPauseMs: number;
  /** Upper bound of rooms kept in memory. */
  maxRooms: number;
  /** Clock used for deadlines (injectable for tests). */
  now?: () => number;
}
export const BOMBER_CONFIG = Symbol('BOMBER_CONFIG');

/** Identity comes from the verified token; nickname/character from the stored profile. */
export interface BomberPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends BomberPlayer {
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
  rules: BomberRules;
  phase: BomberRoomPhase;
  seats: (SeatState | null)[];
  wins: number[];
  roundNumber: number;
  round: BomberRound | null;
  /** Last frame sent, replayed (without events) to whoever reconnects. */
  lastFrame: BomberFrame | null;
  result: BomberMatchResult | null;
  /** Só humanos: CPU não entra na Arena (não dá para farmar contra bot). */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  tickTimer: unknown;
  pauseTimer: unknown;
  botCount: number;
}

type Announcement = {
  [E in BomberServerEventName]: {
    event: E;
    payload: Omit<BomberServerEventPayloads[E], 'seq'>;
  };
}[BomberServerEventName];

/**
 * Authoritative in-memory Bomberman rooms. Every method is synchronous, so two
 * events never interleave inside one room.
 *
 * Policy (same as the UNO tables):
 * - one room per user; a user always gets back the same seat;
 * - a disconnected player keeps the seat for `reconnectGraceMs` (standing still
 *   in the arena meanwhile). Then, or when leaving, the player is out: in the
 *   lobby the seat is freed; during a match the bomber dies and the match goes on;
 * - CPU players fill seats on the host's request and never keep a room alive;
 * - the host role moves to a connected human; the room is deleted when the
 *   last human is gone.
 * State is not persisted: a server restart drops every room.
 */
@Injectable()
export class BomberRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(BOMBER_PUBLISHER) private readonly publisher: BomberPublisher,
    @Inject(BOMBER_CONFIG) private readonly config: BomberConfig,
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
    player: BomberPlayer,
    socketId: string,
    isPublic = true,
  ): BomberSnapshot {
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
      stake: minStake('BOMBER'),
      rules: { ...DEFAULT_BOMBER_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: BOMBER_SEATS }, () => null),
      wins: Array<number>(BOMBER_SEATS).fill(0),
      roundNumber: 0,
      round: null,
      lastFrame: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      tickTimer: undefined,
      pauseTimer: undefined,
      botCount: 0,
    };
    room.seats[0] = this.newSeat(room, player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: BomberPlayer, socketId: string): BomberSnapshot {
    const current = this.userRoom.get(player.userId);
    if (current && current !== code) this.assertFree(player.userId);
    const room = this.rooms.get(code);
    if (!room) throw new DomainError('NOT_FOUND', 'Sala não encontrada');

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
        out.push({ event: 'bomber:player_reconnected', payload: { seat } });
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
        event: 'bomber:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public rooms that can still be joined (in the lobby, a seat free), fullest first. */
  listPublic(): BomberPublicRoom[] {
    const out: BomberPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase !== 'LOBBY' || players >= BOMBER_SEATS)
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
    if (!stakeLevel('BOMBER', stake))
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

  setRules(userId: string, rules: BomberRules): void {
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
    const bot: SeatState = {
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
    room.seats[free] = bot;
    this.publish(room, [
      {
        event: 'bomber:player_joined',
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
        event: 'bomber:player_left',
        payload: { seat, userId: bot.userId, reason: 'removed' },
      },
    ]);
  }

  sync(userId: string): BomberSnapshot {
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
        event: 'bomber:player_disconnected',
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
    if (seated.length < BOMBER_MIN_PLAYERS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'Precisa de pelo menos 2 jogadores (chame a CPU)',
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    room.phase = 'PLAYING';
    room.wins = Array<number>(BOMBER_SEATS).fill(0);
    room.roundNumber = 0;
    room.result = null;
    room.tracker = new MatchTracker(
      room.seats.flatMap((s, i) =>
        s && !s.bot ? [{ seat: i, userId: s.userId }] : [],
      ),
      this.now(),
    );
    this.startRound(room, [{ event: 'bomber:match_started', payload: {} }]);
  }

  /** Back to the lobby with the same seats; everybody confirms again. */
  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.round = null;
    room.lastFrame = null;
    room.result = null;
    for (const s of room.seats) if (s && !s.bot) s.ready = false;
    this.publish(room, []);
  }

  /** Movement and buttons for the next tick; silently ignored outside a running round. */
  input(userId: string, input: BomberInput): void {
    const code = this.userRoom.get(userId);
    const room = code ? this.rooms.get(code) : undefined;
    if (!room?.round || room.phase !== 'PLAYING') return;
    room.round.pushInput(this.seatOf(room, userId)!, input);
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  private startRound(room: Room, out: Announcement[]): void {
    room.roundNumber++;
    const seated = room.seats.flatMap((s, seat) =>
      s ? [{ seat, bot: s.bot }] : [],
    );
    // Shuffle spawn points every round.
    for (let i = seated.length - 1; i > 0; i--) {
      const j = this.random(0, i + 1);
      [seated[i], seated[j]] = [seated[j], seated[i]];
    }
    const round = new BomberRound(room.roundNumber, seated, this.rand);
    room.round = round;
    room.lastFrame = round.frame();
    out.push({
      event: 'bomber:round_started',
      payload: { roundNumber: room.roundNumber },
    });
    this.publish(room, out);
    this.publisher.frame(room.code, room.lastFrame);
    this.scheduleTick(room, round);
  }

  private scheduleTick(room: Room, round: BomberRound): void {
    room.tickTimer = this.timer.set(() => {
      room.tickTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.round !== round) return;
      this.tick(room, round);
    }, BOMBER_TICK_MS);
  }

  private tick(room: Room, round: BomberRound): void {
    round.tick();
    room.lastFrame = round.frame();
    this.publisher.frame(room.code, room.lastFrame);
    if (round.phase === 'over') this.endRound(room, round.result!.winner);
    else this.scheduleTick(room, round);
  }

  private endRound(room: Room, winner: number | null): void {
    if (winner !== null) room.wins[winner]++;
    const out: Announcement[] = [
      {
        event: 'bomber:round_ended',
        payload: {
          roundNumber: room.roundNumber,
          winner,
          wins: [...room.wins],
        },
      },
    ];
    const seated = room.seats.flatMap((s, i) => (s ? [i] : []));
    const champion =
      winner !== null && room.wins[winner] >= room.rules.winsToWin
        ? winner
        : seated.length < BOMBER_MIN_PLAYERS
          ? (seated[0] ?? null)
          : null;
    if (champion !== null) {
      this.finish(room, champion, out);
      return;
    }
    this.publish(room, out);
    room.pauseTimer = this.timer.set(() => {
      room.pauseTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.phase !== 'PLAYING')
        return;
      this.startRound(room, []);
    }, this.config.roundPauseMs);
  }

  private finish(room: Room, winner: number, out: Announcement[]): void {
    this.timer.clear(room.tickTimer);
    this.timer.clear(room.pauseTimer);
    room.tickTimer = room.pauseTimer = undefined;
    room.phase = 'FINISHED';
    room.result = { winner, wins: [...room.wins] };
    out.push({ event: 'bomber:match_over', payload: { ...room.result } });
    this.settle(room, winner);
    this.publish(room, out);
  }

  /** Moedas e ranking: o campeão leva o pote; os demais ficam por rodadas vencidas. */
  private settle(room: Room, winner: number): void {
    const tracker = room.tracker;
    room.tracker = null;
    if (!tracker) return;
    const placeOf = rankSeats(
      tracker.seatList(),
      (seat) => room.wins[seat] ?? 0,
      new Set([winner]),
    );
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'BOMBER',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants(placeOf),
    });
  }

  private removePlayer(
    room: Room,
    userId: string,
    reason: BomberLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    if (room.phase === 'PLAYING') room.tracker?.markLeft(seat);
    room.round?.remove(seat);

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
      { event: 'bomber:player_left', payload: { seat, userId, reason } },
    ];
    // Between rounds with a single bomber left: that one takes the match.
    const seated = room.seats.flatMap((s, i) => (s ? [i] : []));
    if (
      room.phase === 'PLAYING' &&
      room.round?.phase === 'over' &&
      seated.length < BOMBER_MIN_PLAYERS
    ) {
      this.finish(room, seated[0], out);
      return;
    }
    this.publish(room, out);
  }

  /** Keeps the host role with a human who can press "start". */
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
      BomberServerEvents.STATE,
      this.publicState(room),
    );
  }

  private publicState(room: Room): BomberRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length >= BOMBER_MIN_PLAYERS &&
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
      wins: [...room.wins],
      roundNumber: room.roundNumber,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: number): BomberSeatPlayer | null {
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

  private snapshot(room: Room, userId: string): BomberSnapshot {
    return {
      state: this.publicState(room),
      mySeat: this.seatOf(room, userId)!,
      frame:
        room.phase === 'PLAYING' && room.lastFrame
          ? { ...room.lastFrame, events: [] }
          : null,
    };
  }

  private newSeat(
    room: Room,
    player: BomberPlayer,
    socketId: string,
  ): SeatState {
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
    return BOMBER_COLORS.findIndex((_, i) => !used.has(i));
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

  private requirePhase(room: Room, phase: BomberRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.tickTimer);
    this.timer.clear(room.pauseTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
