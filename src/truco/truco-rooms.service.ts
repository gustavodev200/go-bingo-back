import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  partnerOf,
  teamOf,
  TRUCO_SEATS,
  TrucoServerEvents,
  type Seat,
  type TrucoBetResponse,
  type TrucoGesture,
  type TrucoLeftReason,
  type TrucoMatchResult,
  type TrucoMode,
  type TrucoPublicRoom,
  type TrucoRoomPhase,
  type TrucoRoomState,
  type TrucoSnapshot,
  minStake,
  stakeLevel,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { TrucoMatch, type Announcement } from './engine/match';
import { TRUCO_PUBLISHER, type TrucoPublisher } from './truco-publisher';

export interface TrucoConfig {
  /** How long a disconnected player's seat stays reserved. */
  reconnectGraceMs: number;
  /** Pause after a hand ends so everybody sees the result before the next deal. */
  handPauseMs: number;
  /** Upper bound of rooms kept in memory. */
  maxRooms: number;
  /** Clock used for reconnection deadlines (injectable for tests). */
  now?: () => number;
}
export const TRUCO_CONFIG = Symbol('TRUCO_CONFIG');

/** Identity comes from the verified token; nickname/character come from the stored profile. */
export interface TrucoPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends TrucoPlayer {
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
  mode: TrucoMode;
  phase: TrucoRoomPhase;
  seats: (SeatState | null)[];
  match: TrucoMatch | null;
  result: TrucoMatchResult | null;
  /** Quem sentou e quem saiu, para a Arena pagar moedas e pontos no fim. */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  handTimer: unknown;
}

/**
 * Authoritative in-memory truco tables. Every method is synchronous, so two
 * events can never interleave inside one room (Node runs them one at a time).
 *
 * Policy:
 * - one table per user; a user always gets back the same seat;
 * - a disconnected player keeps the seat for `reconnectGraceMs`. Before the
 *   match that seat is then released; during the match the absent team loses
 *   by walkover; after the match the seat is released;
 * - leaving during a match is an immediate walkover;
 * - the host role moves to a connected player when the host goes offline or leaves;
 * - the room is deleted when its last player is gone.
 * State is not persisted: a server restart drops every table.
 */
@Injectable()
export class TrucoRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(TRUCO_PUBLISHER) private readonly publisher: TrucoPublisher,
    @Inject(TRUCO_CONFIG) private readonly config: TrucoConfig,
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
    player: TrucoPlayer,
    socketId: string,
    isPublic = true,
    mode: TrucoMode = 'mineiro',
  ): TrucoSnapshot {
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
      stake: minStake('TRUCO'),
      mode,
      phase: 'LOBBY',
      seats: Array.from({ length: TRUCO_SEATS }, () => null),
      match: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      handTimer: undefined,
    };
    room.seats[0] = this.newSeat(player, socketId);
    this.rooms.set(code, room);
    this.userRoom.set(player.userId, code);
    this.publish(room, []);
    return this.snapshot(room, player.userId);
  }

  join(code: string, player: TrucoPlayer, socketId: string): TrucoSnapshot {
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
        out.push({ event: 'truco:player_reconnected', payload: { seat } });
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
        event: 'truco:player_joined',
        payload: { player: this.seatView(room, free as Seat)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public tables that can still be joined (not playing, a seat free), fullest first. */
  listPublic(): TrucoPublicRoom[] {
    const out: TrucoPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase === 'PLAYING' || players >= TRUCO_SEATS)
        continue;
      const host = room.seats.find((s) => s?.userId === room.hostId)!;
      out.push({
        code: room.code,
        hostNickname: host.nickname,
        hostCharacter: host.character,
        stake: room.stake,
        players,
        mode: room.mode,
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
    if (!stakeLevel('TRUCO', stake))
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

  /** Quem aposta se a partida começar agora: os humanos sentados (sozinho contra CPU não vale nada). */
  stakeCheck(userId: string): { stake: number; userIds: string[] } {
    const room = this.requireRoom(userId);
    const userIds = room.seats.flatMap((s) => (s ? [s.userId] : []));
    return { stake: room.stake, userIds: userIds.length >= 2 ? userIds : [] };
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireRoom(userId);
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  /** Rule set for the next match; only in the lobby (a running match keeps its rules). */
  setMode(userId: string, mode: TrucoMode): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião escolhe o modo');
    room.mode = mode;
    for (const s of room.seats) if (s) s.ready = false;
    this.publish(room, []);
  }

  sync(userId: string): TrucoSnapshot {
    const room = this.requireRoom(userId);
    return this.snapshot(room, userId);
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
    const out: Announcement[] = [
      {
        event: 'truco:player_disconnected',
        payload: { seat, reconnectDeadline: state.reconnectDeadline },
      },
    ];
    // A bet vote never waits on someone who dropped: the partner's vote decides.
    const decided =
      room.phase === 'PLAYING' && room.match
        ? room.match.resolveBetVotes(seat)
        : [];
    if (decided.length > 0) {
      this.afterMatchChange(room, room.match!, [...out, ...decided]);
      return;
    }
    this.publish(room, out);
  }

  takeSeat(userId: string, target: Seat): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.seats[target])
      throw new DomainError('INVALID_STATE', 'Esse lugar está ocupado');
    const from = this.seatOf(room, userId)!;
    room.seats[target] = { ...room.seats[from]!, ready: false };
    room.seats[from] = null;
    this.publish(room, []);
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
    if (seated.length < TRUCO_SEATS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'O truco precisa de 4 jogadores',
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    room.match = new TrucoMatch(this.random, { mode: room.mode });
    room.phase = 'PLAYING';
    room.result = null;
    room.tracker = new MatchTracker(
      seated.map((s) => ({ seat: room.seats.indexOf(s), userId: s.userId })),
      this.now(),
    );
    this.publish(room, [
      { event: 'truco:match_started', payload: {} },
      ...room.match.deal(),
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

  playCard(userId: string, cardId: string): void {
    this.matchAction(userId, (m, seat) => m.play(seat, cardId));
  }

  requestBet(userId: string): void {
    this.matchAction(userId, (m, seat) => m.requestBet(seat));
  }

  /** A vote of the responding team; it counts alone when the partner is away. */
  respondBet(userId: string, response: TrucoBetResponse): void {
    this.matchAction(userId, (m, seat, room) => {
      const partner = room.seats[partnerOf(seat)];
      const solo = !partner || partner.reconnectDeadline !== null;
      return m.respondBet(seat, response, solo);
    });
  }

  decideTen(userId: string, play: boolean): void {
    this.matchAction(userId, (m, seat) => m.decideTen(seat, play));
  }

  /**
   * The gesture goes only to the partner (resolved by the server, never taken
   * from the client). Opponents just learn that the player made a face —
   * which they would see at a real table — never which gesture it was.
   */
  signal(userId: string, gesture: TrucoGesture): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'PLAYING');
    const seat = this.seatOf(room, userId)!;
    const partner = room.seats[partnerOf(seat)];
    if (partner)
      this.publisher.toUser(partner.userId, TrucoServerEvents.SIGNAL_RECEIVED, {
        fromSeat: seat,
        gesture,
      });
    for (const opponent of [(seat + 1) % 4, (seat + 3) % 4]) {
      const other = room.seats[opponent];
      if (other)
        this.publisher.toUser(other.userId, TrucoServerEvents.GESTURED, {
          seat,
        });
    }
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  private matchAction(
    userId: string,
    fn: (match: TrucoMatch, seat: Seat, room: Room) => Announcement[],
  ): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'PLAYING');
    const match = room.match!;
    const out = fn(match, this.seatOf(room, userId)!, room);
    this.afterMatchChange(room, match, out);
  }

  private afterMatchChange(
    room: Room,
    match: TrucoMatch,
    out: Announcement[],
  ): void {
    if (match.winner !== null) {
      room.phase = 'FINISHED';
      room.result = {
        winnerTeam: match.winner,
        reason: 'points',
        scores: [...match.scores],
      };
      this.settle(room, match.winner);
    } else if (match.phase === 'HAND_OVER') {
      room.handTimer = this.timer.set(() => {
        room.handTimer = undefined;
        if (this.rooms.get(room.code) !== room || room.match !== match) return;
        if (room.phase !== 'PLAYING') return;
        this.publish(room, match.deal());
      }, this.config.handPauseMs);
    }
    this.publish(room, out);
  }

  /** Moedas e ranking: a dupla vencedora divide o pote. Roda uma vez por partida. */
  private settle(room: Room, winnerTeam: number): void {
    const tracker = room.tracker;
    room.tracker = null;
    if (!tracker) return;
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'TRUCO',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants((seat) =>
        teamOf(seat as Seat) === winnerTeam ? 1 : 2,
      ),
    });
  }

  private removePlayer(
    room: Room,
    userId: string,
    reason: TrucoLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    const out: Announcement[] = [];
    if (room.phase === 'PLAYING' && room.match) {
      room.tracker?.markLeft(seat);
      out.push(...room.match.abandon(teamOf(seat)));
      room.phase = 'FINISHED';
      room.result = {
        winnerTeam: room.match.winner!,
        reason: 'abandoned',
        scores: [...room.match.scores],
      };
      this.settle(room, room.match.winner!);
      this.timer.clear(room.handTimer);
      room.handTimer = undefined;
    }
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    out.push({ event: 'truco:player_left', payload: { seat, userId, reason } });

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
      TrucoServerEvents.STATE,
      this.publicState(room),
    );
    if (!room.match || room.phase === 'LOBBY') return;
    room.seats.forEach((s, seat) => {
      const hand = s && room.match!.privateView(seat as Seat);
      if (hand)
        this.publisher.toUser(s.userId, TrucoServerEvents.PRIVATE_HAND, hand);
    });
  }

  private publicState(room: Room): TrucoRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length === TRUCO_SEATS &&
      seated.every((s) => s.ready && s.reconnectDeadline === null);
    return {
      code: room.code,
      version: room.version,
      hostId: room.hostId,
      isPublic: room.isPublic,
      stake: room.stake,
      mode: room.mode,
      phase: room.phase,
      lobbyStatus:
        room.phase === 'LOBBY'
          ? ready
            ? 'READY_TO_START'
            : 'WAITING_PLAYERS'
          : null,
      seats: room.seats.map((_, i) => this.seatView(room, i as Seat)),
      scores:
        room.match && room.phase !== 'LOBBY' ? [...room.match.scores] : [0, 0],
      match:
        room.match && room.phase !== 'LOBBY' ? room.match.publicView() : null,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: Seat) {
    const s = room.seats[seat];
    if (!s) return null;
    return {
      seat,
      team: teamOf(seat),
      userId: s.userId,
      nickname: s.nickname,
      character: s.character,
      ready: s.ready,
      connected: s.reconnectDeadline === null,
      reconnectDeadline: s.reconnectDeadline,
    };
  }

  private snapshot(room: Room, userId: string): TrucoSnapshot {
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

  private newSeat(player: TrucoPlayer, socketId: string): SeatState {
    return {
      ...player,
      ready: false,
      sockets: new Set([socketId]),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
  }

  private seatOf(room: Room, userId: string): Seat | null {
    const i = room.seats.findIndex((s) => s?.userId === userId);
    return i < 0 ? null : (i as Seat);
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

  private requirePhase(room: Room, phase: TrucoRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.handTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
