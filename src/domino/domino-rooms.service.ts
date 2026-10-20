import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DEFAULT_DOMINO_RULES,
  DOMINO_MIN_PLAYERS,
  DOMINO_SEATS,
  DominoServerEvents,
  type DominoEmote,
  type DominoLeftReason,
  type DominoMatchEndReason,
  type DominoMatchResult,
  type DominoPublicRoom,
  type DominoRoomPhase,
  type DominoRoomState,
  type DominoRules,
  type DominoSeatPlayer,
  type DominoSide,
  type DominoSnapshot,
  minStake,
  stakeLevel,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { CPU_THINK_MS, cpuNickname, cpuUserId } from '../arena/cpu';
import { MatchTracker, rankSeats } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { dominoBotTurn } from './engine/bot';
import { DominoMatch, type Announcement } from './engine/match';
import { DOMINO_PUBLISHER, type DominoPublisher } from './domino-publisher';

export interface DominoConfig {
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
export const DOMINO_CONFIG = Symbol('DOMINO_CONFIG');

/** Identity comes from the verified token; nickname/character come from the stored profile. */
export interface DominoPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends DominoPlayer {
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
  rules: DominoRules;
  phase: DominoRoomPhase;
  seats: (SeatState | null)[];
  match: DominoMatch | null;
  result: DominoMatchResult | null;
  /** Quem sentou e quem saiu, para a Arena pagar moedas e pontos no fim. */
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  roundTimer: unknown;
  turnTimer: unknown;
  /** Turn token the running turn timer belongs to. */
  turnToken: number | null;
  turnDeadline: number | null;
  botCount: number;
  botTimer: unknown;
  /** Turn token the scheduled CPU move belongs to. */
  botToken: number | null;
}

/**
 * Authoritative in-memory domino tables. Every method is synchronous, so two
 * events can never interleave inside one room (Node runs them one at a time).
 *
 * Policy:
 * - one table per user; a user always gets back the same seat;
 * - every turn has a deadline; when it passes the turn is played automatically;
 * - a disconnected player keeps the seat for `reconnectGraceMs` (their turns
 *   keep timing out meanwhile). Then, or when leaving, the player is out: in the
 *   lobby the seat is freed; during a match their tiles go back to the boneyard
 *   and the match goes on until a single player is left, who wins (in 2 against 2
 *   the other team wins at once);
 * - the host role moves to a connected player when the host goes offline or leaves;
 * - the room is deleted when its last player is gone.
 * State is not persisted: a server restart drops every table.
 */
@Injectable()
export class DominoRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(DOMINO_PUBLISHER) private readonly publisher: DominoPublisher,
    @Inject(DOMINO_CONFIG) private readonly config: DominoConfig,
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
    player: DominoPlayer,
    socketId: string,
    isPublic = true,
  ): DominoSnapshot {
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
      stake: minStake('DOMINO'),
      rules: { ...DEFAULT_DOMINO_RULES },
      phase: 'LOBBY',
      seats: Array.from({ length: DOMINO_SEATS }, () => null),
      match: null,
      result: null,
      tracker: null,
      seq: 0,
      version: 0,
      roundTimer: undefined,
      turnTimer: undefined,
      turnToken: null,
      turnDeadline: null,
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

  join(code: string, player: DominoPlayer, socketId: string): DominoSnapshot {
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
        out.push({ event: 'domino:player_reconnected', payload: { seat } });
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
        event: 'domino:player_joined',
        payload: { player: this.seatView(room, free)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Public tables that can still be joined (not playing, a seat free), fullest first. */
  listPublic(): DominoPublicRoom[] {
    const out: DominoPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = room.seats.filter((s) => s !== null).length;
      if (!room.isPublic || room.phase === 'PLAYING' || players >= DOMINO_SEATS)
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
    if (!stakeLevel('DOMINO', stake))
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
    if (room.seats.some((s) => s?.bot))
      return { stake: room.stake, userIds: [] };
    const userIds = room.seats.flatMap((s) => (s ? [s.userId] : []));
    return { stake: room.stake, userIds: userIds.length >= 2 ? userIds : [] };
  }

  /** O anfitrião completa a mesa com uma CPU (sempre pronta). */
  addBot(userId: string, seat?: number): void {
    const room = this.requireHost(userId, 'Só o anfitrião chama a CPU');
    this.requirePhase(room, 'LOBBY');
    const free = seat ?? room.seats.findIndex((s) => s === null);
    if (free < 0 || room.seats[free])
      throw new DomainError('ROOM_FULL', 'Esse lugar não está vago');
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
        event: 'domino:player_joined',
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
        event: 'domino:player_left',
        payload: { seat, userId: bot.userId, reason: 'removed' },
      },
    ]);
  }

  setVisibility(userId: string, isPublic: boolean): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda a visibilidade');
    room.isPublic = isPublic;
    this.publish(room, []);
  }

  setRules(userId: string, rules: DominoRules): void {
    const room = this.requireHost(userId, 'Só o anfitrião muda as regras');
    this.requirePhase(room, 'LOBBY');
    room.rules = { ...rules };
    this.publish(room, []);
  }

  sync(userId: string): DominoSnapshot {
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
        event: 'domino:player_disconnected',
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
    if (seated.length < DOMINO_MIN_PLAYERS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'O dominó precisa de pelo menos 2 jogadores',
      );
    if (room.rules.teams && seated.length !== DOMINO_SEATS)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        'Em duplas a mesa precisa de 4 jogadores',
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    const seats = room.seats.flatMap((s, i) => (s ? [i] : []));
    const match = new DominoMatch(this.random, seats, room.rules);
    room.match = match;
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
      { event: 'domino:match_started', payload: {} },
      ...match.startRound(),
    ]);
  }

  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.result = null;
    for (const s of room.seats) if (s && !s.bot) s.ready = false;
    this.publish(room, []);
  }

  play(userId: string, tileId: string, side?: DominoSide): void {
    this.matchAction(userId, (m, seat) => m.play(seat, tileId, side));
  }

  draw(userId: string): void {
    this.matchAction(userId, (m, seat) => m.draw(seat));
  }

  /** Quick reaction shown to the whole table. */
  emote(userId: string, emote: DominoEmote): void {
    const room = this.requireRoom(userId);
    this.publisher.toRoom(room.code, DominoServerEvents.EMOTED, {
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
    fn: (match: DominoMatch, seat: number) => Announcement[],
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
    endReason: DominoMatchEndReason = 'points',
  ): void {
    const match = room.match!;
    if (match.phase === 'MATCH_OVER') {
      this.stopTurnClock(room);
      this.timer.clear(room.roundTimer);
      room.roundTimer = undefined;
      room.phase = 'FINISHED';
      room.result = {
        winners: [...match.winners!],
        reason: endReason,
        scores: [...match.scores],
      };
      out.push({ event: 'domino:match_over', payload: { ...room.result } });
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
    this.driveBot(room, match);
  }

  /** Vez de uma CPU: joga depois de uma pausa (se a vez ainda for dela). */
  private driveBot(room: Room, match: DominoMatch): void {
    if (match.phase !== 'PLAYING' || !room.seats[match.turn]?.bot) return;
    const token = match.turnToken;
    if (room.botToken === token) return;
    this.timer.clear(room.botTimer);
    room.botToken = token;
    room.botTimer = this.timer.set(() => {
      room.botTimer = undefined;
      room.botToken = null;
      if (this.rooms.get(room.code) !== room || room.match !== match) return;
      if (match.phase !== 'PLAYING' || match.turnToken !== token) return;
      const seat = match.turn;
      let out: Announcement[];
      try {
        out = dominoBotTurn(match, seat);
      } catch {
        out = match.timeout();
      }
      this.afterMatchChange(room, out);
    }, CPU_THINK_MS);
  }

  /** Moedas e ranking: a dupla (ou o jogador) vencedora leva o pote; os demais ficam por pontos. */
  private settle(room: Room, match: DominoMatch): void {
    const tracker = room.tracker;
    room.tracker = null;
    if (!tracker || !match.winners) return;
    const placeOf = rankSeats(
      tracker.seatList(),
      (seat) => match.scores[seat] ?? 0,
      new Set(match.winners),
    );
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'DOMINO',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants(placeOf),
      cpuPlayers: tracker.cpuPlayers,
    });
  }

  private startTurnClock(room: Room, match: DominoMatch): void {
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
    reason: DominoLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    this.timer.clear(state.expiryTimer);
    room.seats[seat] = null;
    this.userRoom.delete(userId);
    this.publisher.removeFromRoom(userId, room.code);
    const out: Announcement[] = [
      { event: 'domino:player_left', payload: { seat, userId, reason } },
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
      DominoServerEvents.STATE,
      this.publicState(room),
    );
    if (!room.match || room.phase === 'LOBBY') return;
    room.seats.forEach((s, seat) => {
      const hand = s && !s.bot && room.match!.privateView(seat);
      if (hand)
        this.publisher.toUser(s.userId, DominoServerEvents.PRIVATE_HAND, hand);
    });
  }

  private publicState(room: Room): DominoRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length >= DOMINO_MIN_PLAYERS &&
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
      scores: inMatch
        ? [...inMatch.scores]
        : Array<number>(DOMINO_SEATS).fill(0),
      round: inMatch
        ? { ...inMatch.publicView(), turnDeadline: room.turnDeadline }
        : null,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: number): DominoSeatPlayer | null {
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

  private snapshot(room: Room, userId: string): DominoSnapshot {
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

  private newSeat(player: DominoPlayer, socketId: string): SeatState {
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

  private requirePhase(room: Room, phase: DominoRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.roundTimer);
    this.timer.clear(room.turnTimer);
    this.timer.clear(room.botTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
