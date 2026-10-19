import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DEFAULT_UNO_RULES,
  UNO_MIN_PLAYERS,
  UNO_SEATS,
  UnoServerEvents,
  type UnoEmote,
  type UnoLeftReason,
  type UnoMatchEndReason,
  type UnoMatchResult,
  type UnoPlayOptions,
  type UnoPublicRoom,
  type UnoRoomPhase,
  type UnoRoomState,
  type UnoRules,
  type UnoSeatPlayer,
  type UnoSnapshot,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker, rankSeats } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { UnoMatch, type Announcement } from './engine/match';
import { UNO_PUBLISHER, type UnoPublisher } from './uno-publisher';

export interface UnoConfig {
  /** How long a disconnected player's seat stays reserved. */
  reconnectGraceMs: number;
  /** Time to act on a turn before it is played automatically. */
  turnMs: number;
  /** Pause after a round so everybody sees the result before the next deal. */
  roundPauseMs: number;
  /** Upper bound of rooms kept in memory. */
  maxRooms: number;
  /** Clock used for deadlines (injectable for tests). */
  now?: () => number;
}
export const UNO_CONFIG = Symbol('UNO_CONFIG');

/** Identity comes from the verified token; nickname/character come from the stored profile. */
export interface UnoPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends UnoPlayer {
  ready: boolean;
  sockets: Set<string>;
  reconnectDeadline: number | null;
  expiryTimer: unknown;
}

interface Room {
  code: string;
  hostId: string;
  isPublic: boolean;
  rules: UnoRules;
  phase: UnoRoomPhase;
  seats: (SeatState | null)[];
  match: UnoMatch | null;
  result: UnoMatchResult | null;
  /** Quem sentou e quem saiu, para a Arena pagar moedas e pontos no fim. */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  roundTimer: unknown;
  turnTimer: unknown;
  /** Turn token the running turn timer belongs to. */
  turnToken: number | null;
  turnDeadline: number | null;
}

/**
 * Authoritative in-memory UNO tables. Every method is synchronous, so two
 * events can never interleave inside one room (Node runs them one at a time).
 *
 * Policy:
 * - one table per user; a user always gets back the same seat;
 * - every turn has a deadline; when it passes the turn is played automatically;
 * - a disconnected player keeps the seat for `reconnectGraceMs` (their turns
 *   keep timing out meanwhile). Then, or when leaving, the player is out: in the
 *   lobby the seat is freed; during a match their cards go back to the pile and
 *   the match goes on, until a single player is left, who wins;
 * - the host role moves to a connected player when the host goes offline or leaves;
 * - the room is deleted when its last player is gone.
 * State is not persisted: a server restart drops every table.
 */
@Injectable()
export class UnoRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(UNO_PUBLISHER) private readonly publisher: UnoPublisher,
    @Inject(UNO_CONFIG) private readonly config: UnoConfig,
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

  create(player: UnoPlayer, socketId: string, isPublic = true): UnoSnapshot {
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
      rules: { ...DEFAULT_UNO_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: UNO_SEATS }, () => null),
      match: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      roundTimer: undefined,
      turnTimer: undefined,
      turnToken: null,
      turnDeadline: null,
    };
    room.seats[0] = this.newSeat(player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: UnoPlayer, socketId: string): UnoSnapshot {
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
        out.push({ event: 'uno:player_reconnected', payload: { seat } });
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
        event: 'uno:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public tables that can still be joined (not playing, a seat free), fullest first. */
  listPublic(): UnoPublicRoom[] {
    const out: UnoPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase === 'PLAYING' || players >= UNO_SEATS)
        continue;
      const host = room.seats.find((s) => s?.userId === room.hostId)!;
      out.push({
        code: room.code,
        hostNickname: host.nickname,
        hostCharacter: host.character,
        players,
        rules: { ...room.rules },
      });
    }
    return out.sort((a, b) => b.players - a.players);
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  setRules(userId: string, rules: UnoRules): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda as regras');
    this.requirePhase(room, 'LOBBY');
    room.rules = { ...rules };
    this.publish(room, []);
  }

  sync(userId: string): UnoSnapshot {
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
        event: 'uno:player_disconnected',
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
    if (seated.length < UNO_MIN_PLAYERS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'O UNO precisa de pelo menos 2 jogadores',
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    const seats = room.seats.flatMap((s, i) => (s ? [i] : []));
    const match = new UnoMatch(this.random, seats, room.rules);
    room.match = match;
    room.phase = 'PLAYING';
    room.result = null;
    room.tracker = new MatchTracker(
      seated.map((s) => ({
        seat: room.seats.indexOf(s),
        userId: s.userId,
      })),
      this.now(),
    );
    this.afterMatchChange(room, [
      { event: 'uno:match_started', payload: {} },
      ...match.startRound(),
    ]);
  }

  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.result = null;
    for (const s of room.seats) if (s) s.ready = false;
    this.publish(room, []);
  }

  playCard(userId: string, cardId: string, opts: UnoPlayOptions): void {
    this.matchAction(userId, (m, seat) => m.play(seat, cardId, opts));
  }

  draw(userId: string): void {
    this.matchAction(userId, (m, seat) => m.draw(seat));
  }

  pass(userId: string): void {
    this.matchAction(userId, (m, seat) => m.pass(seat));
  }

  challenge(userId: string): void {
    this.matchAction(userId, (m, seat) => m.challenge(seat));
  }

  callUno(userId: string): void {
    this.matchAction(userId, (m, seat) => m.callUno(seat));
  }

  catchUno(userId: string): void {
    this.matchAction(userId, (m, seat) => m.catchUno(seat));
  }

  /** Quick reaction shown to the whole table. */
  emote(userId: string, emote: UnoEmote): void {
    const room = this.requireRoom(userId);
    this.publisher.toRoom(room.code, UnoServerEvents.EMOTED, {
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
    fn: (match: UnoMatch, seat: number) => Announcement[],
  ): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'PLAYING');
    const out = fn(room.match!, this.seatOf(room, userId)!);
    this.afterMatchChange(room, out);
  }

  /** Ends the match, schedules the next round or restarts the turn clock, then publishes. */
  private afterMatchChange(
    room: Room,
    out: Announcement[],
    endReason: UnoMatchEndReason = 'points',
  ): void {
    const match = room.match!;
    if (match.phase === 'MATCH_OVER') {
      this.stopTurnClock(room);
      this.timer.clear(room.roundTimer);
      room.roundTimer = undefined;
      room.phase = 'FINISHED';
      room.result = {
        winner: match.winner!,
        reason: endReason,
        scores: [...match.scores],
      };
      out.push({ event: 'uno:match_over', payload: { ...room.result } });
      this.settle(room, match);
    } else if (match.phase === 'ROUND_OVER') {
      this.stopTurnClock(room);
      if (!room.roundTimer)
        room.roundTimer = this.timer.set(() => {
          room.roundTimer = undefined;
          if (this.rooms.get(room.code) !== room || room.match !== match)
            return;
          if (match.phase !== 'ROUND_OVER') return;
          this.afterMatchChange(room, match.startRound());
        }, this.config.roundPauseMs);
    } else if (room.turnToken !== match.turnToken) {
      this.startTurnClock(room, match);
    }
    this.publish(room, out);
  }

  /** Moedas e ranking: o vencedor leva o pote; os demais ficam por pontos. Roda uma vez por partida. */
  private settle(room: Room, match: UnoMatch): void {
    const tracker = room.tracker;
    room.tracker = null;
    if (!tracker || match.winner === null) return;
    const placeOf = rankSeats(
      tracker.seatList(),
      (seat) => match.scores[seat] ?? 0,
      new Set([match.winner]),
    );
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'UNO',
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants(placeOf),
    });
  }

  private startTurnClock(room: Room, match: UnoMatch): void {
    this.timer.clear(room.turnTimer);
    const token = match.turnToken;
    room.turnToken = token;
    room.turnDeadline = this.now() + this.config.turnMs;
    room.turnTimer = this.timer.set(() => {
      room.turnTimer = undefined;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      if (match.phase !== 'PLAYING' || match.turnToken !== token) return;
      this.afterMatchChange(room, match.timeout());
    }, this.config.turnMs);
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
    reason: UnoLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    const out: Announcement[] = [
      { event: 'uno:player_left', payload: { seat, userId, reason } },
    ];

    if (room.seats.every((s) => s === null)) {
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
      this.afterMatchChange(room, out, 'abandoned');
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

  /** Announcements first (with their seq), then the public state, then each private hand. */
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
      UnoServerEvents.STATE,
      this.publicState(room),
    );
    if (!room.match || room.phase === 'LOBBY') return;
    room.seats.forEach((s, seat) => {
      const hand = s && room.match!.privateView(seat);
      if (hand)
        this.publisher.toUser(s.userId, UnoServerEvents.PRIVATE_HAND, hand);
    });
  }

  private publicState(room: Room): UnoRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length >= UNO_MIN_PLAYERS &&
      seated.every((s) => s.ready && s.reconnectDeadline === null);
    const inMatch = room.match && room.phase !== 'LOBBY' ? room.match : null;
    return {
      code: room.code,
      version: room.version,
      hostId: room.hostId,
      isPublic: room.isPublic,
      rules: { ...room.rules },
      phase: room.phase,
      lobbyStatus:
        room.phase === 'LOBBY'
          ? ready
            ? 'READY_TO_START'
            : 'WAITING_PLAYERS'
          : null,
      seats: room.seats.map((_, i) => this.seatView(room, i)),
      scores: inMatch ? [...inMatch.scores] : Array<number>(UNO_SEATS).fill(0),
      round: inMatch
        ? { ...inMatch.publicView(), turnDeadline: room.turnDeadline }
        : null,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: number): UnoSeatPlayer | null {
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

  private snapshot(room: Room, userId: string): UnoSnapshot {
    const mySeat = this.seatOf(room, userId)!;
    return {
      state: this.publicState(room),
      mySeat,
      hand:
        room.match && room.phase !== 'LOBBY'
          ? room.match.privateView(mySeat)
          : null,
    };
  }

  private newSeat(player: UnoPlayer, socketId: string): SeatState {
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

  private requirePhase(room: Room, phase: UnoRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.roundTimer);
    this.timer.clear(room.turnTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
