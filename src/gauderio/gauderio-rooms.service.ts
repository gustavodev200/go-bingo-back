import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  GAUD_DEFAULT_SETTINGS,
  GAUD_MAX_SEATS,
  GaudServerEvents,
  gaudTeamOf,
  minStake,
  stakeLevel,
  type GaudCall,
  type GaudLeftReason,
  type GaudMatchResult,
  type GaudPublicRoom,
  type GaudRoomPhase,
  type GaudRoomState,
  type GaudSeat,
  type GaudSeatPlayer,
  type GaudSettings,
  type GaudSnapshot,
} from '../contracts';
import { ArenaService } from '../arena/arena.service';
import { MatchTracker } from '../arena/match-tracker';
import { DomainError } from '../core/domain-error';
import { RANDOM_INT, type RandomInt } from '../core/random';
import { DRAW_TIMER, type DrawTimer } from '../game/draw-timer';
import { generateRoomCode } from '../rooms/room-code';
import { GaudMatch, type Announcement } from './engine/match';
import { GAUD_PUBLISHER, type GaudPublisher } from './gauderio-publisher';

export interface GaudConfig {
  /** Quanto tempo o lugar de quem caiu fica reservado. */
  reconnectGraceMs: number;
  /** Pausa entre o fim de uma mão e a próxima distribuição. */
  handPauseMs: number;
  /** Máximo de mesas em memória. */
  maxRooms: number;
  /** Relógio dos prazos de reconexão (injetável nos testes). */
  now?: () => number;
}
export const GAUD_CONFIG = Symbol('GAUD_CONFIG');

/** Identidade vem do token verificado; apelido/personagem vêm do perfil. */
export interface GaudPlayer {
  userId: string;
  nickname: string;
  character: string | null;
}

interface SeatState extends GaudPlayer {
  ready: boolean;
  sockets: Set<string>;
  reconnectDeadline: number | null;
  expiryTimer: unknown;
}

interface Room {
  code: string;
  hostId: string;
  isPublic: boolean;
  stake: number;
  settings: GaudSettings;
  phase: GaudRoomPhase;
  /** Sempre 4 posições; só as `settings.size` primeiras são usadas. */
  seats: (SeatState | null)[];
  match: GaudMatch | null;
  result: GaudMatchResult | null;
  tracker: MatchTracker | null;
  seq: number;
  version: number;
  handTimer: unknown;
}

/**
 * Mesas de Truco Gaudério em memória, autoridade única. Tudo síncrono: dois
 * eventos nunca se intercalam dentro de uma mesa.
 *
 * Política (igual ao truco): um usuário, uma mesa; reconexão volta ao mesmo
 * lugar; quem cai tem `reconnectGraceMs` (antes da partida o lugar é liberado,
 * durante a partida a dupla perde por W.O.); sair durante a partida é W.O.;
 * o anfitrião passa para alguém conectado; a mesa some quando esvazia.
 */
@Injectable()
export class GaudRoomsService implements OnModuleDestroy {
  private readonly rooms = new Map<string, Room>();
  private readonly userRoom = new Map<string, string>();

  constructor(
    @Inject(GAUD_PUBLISHER) private readonly publisher: GaudPublisher,
    @Inject(GAUD_CONFIG) private readonly config: GaudConfig,
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
    player: GaudPlayer,
    socketId: string,
    isPublic = true,
    settings: GaudSettings = GAUD_DEFAULT_SETTINGS,
  ): GaudSnapshot {
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
      stake: minStake('GAUDERIO'),
      settings: { ...settings },
      phase: 'LOBBY',
      seats: Array.from({ length: GAUD_MAX_SEATS }, () => null),
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

  join(code: string, player: GaudPlayer, socketId: string): GaudSnapshot {
    const current = this.userRoom.get(player.userId);
    if (current && current !== code) this.assertFree(player.userId);
    const room = this.rooms.get(code);
    if (!room) throw new DomainError('NOT_FOUND', 'Mesa não encontrada');

    const seat = this.seatOf(room, player.userId);
    const out: Announcement[] = [];
    if (seat !== null) {
      const state = room.seats[seat]!;
      state.sockets.add(socketId);
      if (state.reconnectDeadline !== null) {
        this.timer.clear(state.expiryTimer);
        state.reconnectDeadline = null;
        state.expiryTimer = undefined;
        out.push({ event: 'gauderio:player_reconnected', payload: { seat } });
      }
    } else {
      if (room.phase === 'PLAYING')
        throw new DomainError(
          'GAME_IN_PROGRESS',
          'A partida já começou nessa mesa',
        );
      const free = room.seats
        .slice(0, room.settings.size)
        .findIndex((s) => s === null);
      if (free < 0) throw new DomainError('ROOM_FULL', 'A mesa está cheia');
      room.seats[free] = this.newSeat(player, socketId);
      this.userRoom.set(player.userId, code);
      out.push({
        event: 'gauderio:player_joined',
        payload: { player: this.seatView(room, free as GaudSeat)! },
      });
    }
    this.ensureConnectedHost(room);
    this.publish(room, out);
    return this.snapshot(room, player.userId);
  }

  /** Mesas públicas com lugar livre e fora de partida, as mais cheias primeiro. */
  listPublic(): GaudPublicRoom[] {
    const out: GaudPublicRoom[] = [];
    for (const room of this.rooms.values()) {
      const players = this.seatedCount(room);
      if (
        !room.isPublic ||
        room.phase === 'PLAYING' ||
        players >= room.settings.size
      )
        continue;
      const host = room.seats.find((s) => s?.userId === room.hostId)!;
      out.push({
        code: room.code,
        hostNickname: host.nickname,
        hostCharacter: host.character,
        stake: room.stake,
        players,
        settings: { ...room.settings },
      });
    }
    return out.sort((a, b) => b.players - a.players);
  }

  setStake(userId: string, stake: number): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda a aposta');
    if (!stakeLevel('GAUDERIO', stake))
      throw new DomainError(
        'INVALID_PAYLOAD',
        'Aposta inválida para este jogo',
      );
    if (room.stake === stake) return;
    room.stake = stake;
    this.unready(room);
    this.publish(room, []);
  }

  stakeToJoin(code: string, userId: string): number | null {
    const room = this.rooms.get(code);
    if (!room || this.seatOf(room, userId) !== null) return null;
    return room.stake;
  }

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

  /** Regras da próxima partida (só no lobby). Ir de 4 para 2 exige os lugares 3 e 4 vazios. */
  setSettings(userId: string, settings: GaudSettings): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (room.hostId !== userId)
      throw new DomainError('NOT_HOST', 'Só o anfitrião muda as regras');
    if (room.seats.slice(settings.size).some((s) => s !== null))
      throw new DomainError(
        'INVALID_STATE',
        'Tem gente nos lugares 3 e 4. Peça para trocarem de lugar ou saírem',
      );
    room.settings = { ...settings };
    this.unready(room);
    this.publish(room, []);
  }

  sync(userId: string): GaudSnapshot {
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
        event: 'gauderio:player_disconnected',
        payload: { seat, reconnectDeadline: state.reconnectDeadline },
      },
    ]);
  }

  takeSeat(userId: string, target: GaudSeat): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'LOBBY');
    if (target >= room.settings.size)
      throw new DomainError(
        'INVALID_STATE',
        'Esse lugar não existe nesta mesa',
      );
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
    if (seated.length < room.settings.size)
      throw new DomainError(
        'NOT_ENOUGH_PLAYERS',
        `Esta mesa precisa de ${room.settings.size} jogadores`,
      );
    if (seated.some((s) => s.reconnectDeadline !== null))
      throw new DomainError('INVALID_STATE', 'Espere todo mundo se reconectar');
    if (seated.some((s) => !s.ready))
      throw new DomainError('INVALID_STATE', 'Todos precisam estar prontos');
    room.match = new GaudMatch(this.random, room.settings);
    room.phase = 'PLAYING';
    room.result = null;
    room.tracker = new MatchTracker(
      seated.map((s) => ({ seat: room.seats.indexOf(s), userId: s.userId })),
      this.now(),
    );
    this.publish(room, [
      { event: 'gauderio:match_started', payload: {} },
      ...room.match.deal(),
    ]);
  }

  rematch(userId: string): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'FINISHED');
    room.phase = 'LOBBY';
    room.match = null;
    room.result = null;
    this.unready(room);
    this.publish(room, []);
  }

  playCard(userId: string, cardId: string, hidden: boolean): void {
    this.matchAction(userId, (m, seat) => m.play(seat, cardId, hidden));
  }

  call(userId: string, call: GaudCall): void {
    this.matchAction(userId, (m, seat) => m.call(seat, call));
  }

  respond(userId: string, accept: boolean): void {
    this.matchAction(userId, (m, seat) => m.respond(seat, accept));
  }

  fold(userId: string): void {
    this.matchAction(userId, (m, seat) => m.fold(seat));
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.userRoom.clear();
  }

  private matchAction(
    userId: string,
    fn: (match: GaudMatch, seat: GaudSeat) => Announcement[],
  ): void {
    const room = this.requireRoom(userId);
    this.requirePhase(room, 'PLAYING');
    const match = room.match!;
    const out = fn(match, this.seatOf(room, userId)!);
    this.afterMatchChange(room, match, out);
  }

  private afterMatchChange(
    room: Room,
    match: GaudMatch,
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
      this.timer.clear(room.handTimer);
      room.handTimer = this.timer.set(() => {
        room.handTimer = undefined;
        if (this.rooms.get(room.code) !== room || room.match !== match) return;
        if (room.phase !== 'PLAYING') return;
        this.publish(room, match.deal());
      }, this.config.handPauseMs);
    }
    this.publish(room, out);
  }

  /** Arena: o lado vencedor divide o pote. Uma vez por partida. */
  private settle(room: Room, winnerTeam: number): void {
    const tracker = room.tracker;
    room.tracker = null;
    if (!tracker) return;
    void this.arena.settleSafe({
      matchId: tracker.matchId,
      game: 'GAUDERIO',
      stake: room.stake,
      durationMs: tracker.durationMs(this.now()),
      participants: tracker.participants((seat) =>
        gaudTeamOf(seat) === winnerTeam ? 1 : 2,
      ),
    });
  }

  private removePlayer(
    room: Room,
    userId: string,
    reason: GaudLeftReason,
  ): void {
    const seat = this.seatOf(room, userId)!;
    const state = room.seats[seat]!;
    const out: Announcement[] = [];
    if (room.phase === 'PLAYING' && room.match) {
      room.tracker?.markLeft(seat);
      out.push(...room.match.abandon(gaudTeamOf(seat)));
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
    out.push({
      event: 'gauderio:player_left',
      payload: { seat, userId, reason },
    });

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

  private ensureConnectedHost(room: Room): void {
    const host = room.seats.find((s) => s?.userId === room.hostId);
    if (host && host.sockets.size > 0) return;
    const next = room.seats.find((s) => s && s.sockets.size > 0);
    if (next) room.hostId = next.userId;
  }

  /** Anúncios primeiro (com seq), depois o estado público e cada mão privada. */
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
      GaudServerEvents.STATE,
      this.publicState(room),
    );
    if (!room.match || room.phase === 'LOBBY') return;
    room.seats.forEach((s, seat) => {
      const hand = s && room.match!.privateView(seat as GaudSeat);
      if (hand)
        this.publisher.toUser(s.userId, GaudServerEvents.PRIVATE_HAND, hand);
    });
  }

  private publicState(room: Room): GaudRoomState {
    const seated = room.seats.filter((s) => s !== null);
    const ready =
      seated.length === room.settings.size &&
      seated.every((s) => s.ready && s.reconnectDeadline === null);
    const inMatch = room.match && room.phase !== 'LOBBY';
    return {
      code: room.code,
      version: room.version,
      hostId: room.hostId,
      isPublic: room.isPublic,
      stake: room.stake,
      settings: { ...room.settings },
      phase: room.phase,
      lobbyStatus:
        room.phase === 'LOBBY'
          ? ready
            ? 'READY_TO_START'
            : 'WAITING_PLAYERS'
          : null,
      seats: room.seats.map((_, i) => this.seatView(room, i as GaudSeat)),
      scores: inMatch ? [...room.match!.scores] : [0, 0],
      match: inMatch ? room.match!.publicView() : null,
      result: room.result,
    };
  }

  private seatView(room: Room, seat: GaudSeat): GaudSeatPlayer | null {
    const s = room.seats[seat];
    if (!s) return null;
    return {
      seat,
      team: gaudTeamOf(seat),
      userId: s.userId,
      nickname: s.nickname,
      character: s.character,
      ready: s.ready,
      connected: s.reconnectDeadline === null,
      reconnectDeadline: s.reconnectDeadline,
    };
  }

  private snapshot(room: Room, userId: string): GaudSnapshot {
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

  private newSeat(player: GaudPlayer, socketId: string): SeatState {
    return {
      ...player,
      ready: false,
      sockets: new Set([socketId]),
      reconnectDeadline: null,
      expiryTimer: undefined,
    };
  }

  private unready(room: Room): void {
    for (const s of room.seats) if (s) s.ready = false;
  }

  private seatedCount(room: Room): number {
    return room.seats.filter((s) => s !== null).length;
  }

  private seatOf(room: Room, userId: string): GaudSeat | null {
    const i = room.seats.findIndex((s) => s?.userId === userId);
    return i < 0 ? null : (i as GaudSeat);
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

  private requirePhase(room: Room, phase: GaudRoomPhase): void {
    if (room.phase !== phase)
      throw new DomainError('INVALID_STATE', 'Ação indisponível agora');
  }

  private clearTimers(room: Room): void {
    this.timer.clear(room.handTimer);
    for (const s of room.seats) if (s) this.timer.clear(s.expiryTimer);
  }
}
