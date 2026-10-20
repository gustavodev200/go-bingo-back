import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  BJ_SEATS,
  DEFAULT_BJ_RULES,
  BjServerEvents,
  minStake,
  stakeLevel,
  type BjAction,
  type BjEmote,
  type BjLeftReason,
  type BjMatchResult,
  type BjPublicRoom,
  type BjRoomPhase,
  type BjRoomState,
  type BjRules,
  type BjSeatPlayer,
  type BjSnapshot,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { BjMatch, type Announcement } from './engine/match';
import { BJ_PUBLISHER, type BjPublisher } from './blackjack-publisher';

export interface BjConfig {
  /** How long a disconnected player's seat stays reserved. */
  reconnectGraceMs: number;
  /** Upper bound of rooms kept in memory. */
  maxRooms: number;
  /** Clock used for deadlines (injectable for tests). */
  now?: () => number;
}
export const BJ_CONFIG = Symbol('BJ_CONFIG');

/** Identity comes from the verified token; nickname/character come from the stored profile. */
export interface BjPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends BjPlayer {
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
  rules: BjRules;
  phase: BjRoomPhase;
  seats: (SeatState | null)[];
  match: BjMatch | null;
  result: BjMatchResult | null;
  /** Quem sentou e quem saiu, para a Arena pagar moedas e pontos no fim. */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  stageTimer: unknown;
  /** Match token the running stage timer belongs to. */
  stageToken: number | null;
  stageDeadline: number | null;
}

/**
 * Authoritative in-memory blackjack tables (up to BJ_SEATS players against
 * the dealer). Every method is synchronous, so two events can never
 * interleave inside one room.
 *
 * Policy:
 * - one table per user; a user always gets back the same seat;
 * - one player is enough to start (practice against the dealer, nothing is
 *   settled); with two or more the final chip count goes to the Arena;
 * - every stage has a deadline (bet, insurance, decision, pause between
 *   rounds); when it passes the server plays the safe default;
 * - a disconnected player keeps the seat for `reconnectGraceMs` (the clock
 *   keeps running). Then, or when leaving mid-match, their bets are lost and
 *   they place last;
 * - the host role moves to a connected player when the host goes offline or leaves;
 * - the room is deleted when it gets empty.
 * State is not persisted: a server restart drops every table.
 */
@Injectable()
export class BjRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(BJ_PUBLISHER) private readonly publisher: BjPublisher,
    @Inject(BJ_CONFIG) private readonly config: BjConfig,
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

  create(player: BjPlayer, socketId: string, isPublic = true): BjSnapshot {
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
      stake: minStake('BLACKJACK'),
      rules: { ...DEFAULT_BJ_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: BJ_SEATS }, () => null),
      match: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      stageTimer: undefined,
      stageToken: null,
      stageDeadline: null,
    };
    room.seats[0] = this.newSeat(player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: BjPlayer, socketId: string): BjSnapshot {
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
        out.push({ event: 'blackjack:player_reconnected', payload: { seat } });
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
        event: 'blackjack:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public tables still taking players. */
  listPublic(): BjPublicRoom[] {
    const out: BjPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase === 'PLAYING' || players >= BJ_SEATS)
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
    if (!stakeLevel('BLACKJACK', stake))
      throw new DomainError(
        'INVALID_PAYLOAD',
        'Aposta inválida para este jogo',
      );
    if (room.stake === stake) return;
    room.stake = stake;
    for (const s of room.seats) if (s) s.ready = false;
    this.publish(room, []);
  }

  /** Aposta que quem chega precisa cobrir; null = já tem lugar aqui (reconexão) ou a mesa não existe. */
  stakeToJoin(code: string, userId: string): number | null {
    const room = this.rooms.get(code);
    if (!room || this.seatOf(room, userId) !== null) return null;
    return room.stake;
  }

  /** Quem aposta se a partida começar agora: todos os sentados, se forem 2 ou mais (sozinho é treino). */
  stakeCheck(userId: string): { stake: number; userIds: string[] } {
    const room = this.requireRoom(userId);
    const userIds = room.seats.flatMap((s) => (s ? [s.userId] : []));
    return { stake: room.stake, userIds: userIds.length >= 2 ? userIds : [] };
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  setRules(userId: string, rules: BjRules): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda as regras');
    this.requirePhase(room, 'LOBBY');
    room.rules = { ...rules };
    this.publish(room, []);
  }

  sync(userId: string): BjSnapshot {
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
        event: 'blackjack:player_disconnected',
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
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    const seats = seated.map((s) => room.seats.indexOf(s));
    const names = new Map(seated.map((s, i) => [seats[i], s]));
    room.match = new BjMatch(
      this.random,
      seats,
      room.rules,
      (seat) => names.get(seat)!.nickname,
      (seat) => names.get(seat)!.userId,
    );
    room.phase = 'PLAYING';
    room.result = null;
    // Sozinho é treino contra o dealer: nada vai para a Arena.
    room.tracker =
      seated.length >= 2
        ? new MatchTracker(
            seated.map((s, i) => ({ seat: seats[i], userId: s.userId })),
            this.now(),
          )
        : null;
    this.afterMatchChange(room, [
      {
        event: 'blackjack:match_started',
        payload: { rounds: room.rules.rounds },
      },
      { event: 'blackjack:round_started', payload: { round: 1 } },
    ]);
  }

  /** Back to the lobby for another tournament. */
  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.result = null;
    for (const s of room.seats) if (s) s.ready = false;
    this.publish(room, []);
  }

  bet(userId: string, amount: number): void {
    this.matchAction(userId, (m, seat) => m.bet(seat, amount));
  }

  insurance(userId: string, take: boolean): void {
    this.matchAction(userId, (m, seat) => m.insurance(seat, take));
  }

  act(userId: string, action: BjAction): void {
    this.matchAction(userId, (m, seat) => m.act(seat, action));
  }

  /** Quick reaction shown to the whole table. */
  emote(userId: string, emote: BjEmote): void {
    const room = this.requireRoom(userId);
    this.publisher.toRoom(room.code, BjServerEvents.EMOTED, {
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
    fn: (match: BjMatch, seat: number) => Announcement[],
  ): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'PLAYING');
    const out = fn(room.match!, this.seatOf(room, userId)!);
    this.afterMatchChange(room, out);
  }

  /** Ends the match or restarts the stage clock, then publishes. */
  private afterMatchChange(room: Room, out: Announcement[]): void {
    const match = room.match!;
    if (match.phase === 'OVER') {
      this.stopStageClock(room);
      room.phase = 'FINISHED';
      room.result = match.result;
      this.settle(room);
    } else if (room.stageToken !== match.turnToken) {
      this.startStageClock(room, match);
    }
    this.publish(room, out);
  }

  /**
   * Moedas e ranking pelas fichas finais (1 = mais fichas; empates dividem a
   * colocação). Todo mundo empatado no topo não é liquidado: ninguém venceu.
   */
  private settle(room: Room): void {
    const tracker = room.tracker;
    room.tracker = null;
    const standings = room.result?.standings ?? [];
    if (!tracker || standings.length < 2) return;
    const placement = new Map(standings.map((s) => [s.seat, s.placement]));
    if (standings.every((s) => s.placement === 1)) return;
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'BLACKJACK',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants(
        (seat) => placement.get(seat) ?? standings.length,
      ),
    });
  }

  private startStageClock(room: Room, match: BjMatch): void {
    this.timer.clear(room.stageTimer);
    const token = match.turnToken;
    const ms = match.stageMs;
    room.stageToken = token;
    room.stageDeadline = this.now() + ms;
    room.stageTimer = this.timer.set(() => {
      room.stageTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      if (match.phase !== 'PLAYING' || match.turnToken !== token) return;
      this.afterMatchChange(room, match.timeout());
    }, ms);
  }

  private stopStageClock(room: Room): void {
    this.timer.clear(room.stageTimer);
    room.stageTimer = undefined;
    room.stageToken = null;
    room.stageDeadline = null;
  }

  private removePlayer(room: Room, userId: string, reason: BjLeftReason): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    const out: Announcement[] = [
      { event: 'blackjack:player_left', payload: { seat, userId, reason } },
    ];

    if (room.seats.every((s) => s === null)) {
      // Only a solo table empties mid-match (with two or more the match ends first): nothing to settle.
      this.clearTimers(room);
      this.rooms.delete(room.code);
      this.publisher.publicRoomsChanged(() => this.listPublic());
      return;
    }
    if (room.hostId === userId) {
      const next = room.seats.find((s) => s && s.sockets.size > 0);
      room.hostId = (next ?? room.seats.find((s) => s !== null)!).userId;
    }
    if (room.phase === 'PLAYING' && room.match) {
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
      BjServerEvents.STATE,
      this.publicState(room),
    );
  }

  private publicState(room: Room): BjRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length > 0 &&
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
      game: inMatch
        ? { ...inMatch.publicView(), deadline: room.stageDeadline }
        : null,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: number): BjSeatPlayer | null {
    const s = room.seats[seat];
    if (!s) return null;
    return {
      seat,
      userId: s.userId,
      nickname: s.nickname,
      character: s.character,
      ready: s.ready,
      connected: s.reconnectDeadline === null,
      reconnectDeadline: s.reconnectDeadline,
    };
  }

  private snapshot(room: Room, userId: string): BjSnapshot {
    return {
      state: this.publicState(room),
      mySeat: this.seatOf(room, userId)!,
    };
  }

  private newSeat(player: BjPlayer, socketId: string): SeatState {
    return {
      ...player,
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

  private requirePhase(room: Room, phase: BjRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.stageTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
