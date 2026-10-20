import type { ArenaService } from '../arena/arena.service';
import type {
  GaudPrivateHand,
  GaudPublicRoom,
  GaudRoomState,
  GaudServerEventName,
  GaudSettings,
} from '../contracts';
import { DomainError } from '../core/domain-error';
import type { DrawTimer } from '../game/draw-timer';
import type { GaudPublisher } from './gauderio-publisher';
import {
  GaudRoomsService,
  type GaudConfig,
  type GaudPlayer,
} from './gauderio-rooms.service';

interface Sent {
  to: string;
  event: GaudServerEventName;
  payload: unknown;
}

class FakePublisher implements GaudPublisher {
  sent: Sent[] = [];
  removed: string[] = [];
  toRoom(code: string, event: GaudServerEventName, payload: unknown) {
    this.sent.push({ to: `room:${code}`, event, payload });
  }
  toUser(userId: string, event: GaudServerEventName, payload: unknown) {
    this.sent.push({ to: `user:${userId}`, event, payload });
  }
  removeFromRoom(userId: string, code: string) {
    this.removed.push(`${userId}@${code}`);
  }
  publicList: () => GaudPublicRoom[] = () => [];
  publicRoomsChanged(list: () => GaudPublicRoom[]) {
    this.publicList = list;
  }
  last<T>(event: GaudServerEventName, to?: string): T {
    const found = this.sent.filter(
      (s) => s.event === event && (!to || s.to === to),
    );
    return found[found.length - 1]?.payload as T;
  }
  count(event: GaudServerEventName, to?: string) {
    return this.sent.filter((s) => s.event === event && (!to || s.to === to))
      .length;
  }
}

class FakeTimer implements DrawTimer {
  pending: { fn: () => void; ms: number; id: number }[] = [];
  private nextId = 1;
  set(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.pending.push({ fn, ms, id });
    return id;
  }
  clear(handle: unknown) {
    this.pending = this.pending.filter((p) => p.id !== handle);
  }
  fire(ms: number) {
    const due = this.pending.filter((p) => p.ms === ms);
    this.pending = this.pending.filter((p) => p.ms !== ms);
    due.forEach((p) => p.fn());
  }
}

const GRACE = 30_000;
const PAUSE = 2_000;
const FOUR: GaudSettings = { size: 4, target: 12, flor: true };

const players: GaudPlayer[] = ['Ana', 'Bia', 'Caio', 'Duda', 'Edu'].map(
  (nickname, i) => ({ userId: `u${i}`, nickname, character: null }),
);
const [ana, bia, caio, duda, edu] = players;

function setup(config: Partial<GaudConfig> = {}) {
  const publisher = new FakePublisher();
  const timer = new FakeTimer();
  let seed = 1;
  const random = (min: number, max: number) => {
    seed = (seed * 48271) % 2147483647;
    return min + (seed % (max - min));
  };
  const arena = { settleSafe: jest.fn().mockResolvedValue(null) };
  const service = new GaudRoomsService(
    publisher,
    {
      reconnectGraceMs: GRACE,
      handPauseMs: PAUSE,
      maxRooms: 10,
      now: () => 1_000,
      ...config,
    },
    random,
    timer,
    arena as unknown as ArenaService,
  );
  return { service, publisher, timer, arena };
}
type T = ReturnType<typeof setup>;

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const state = (t: T) => t.publisher.last<GaudRoomState>('gauderio:state');
const handOf = (t: T, p: GaudPlayer) =>
  t.publisher.last<GaudPrivateHand>(
    'gauderio:private_hand',
    `user:${p.userId}`,
  );

/** Mesa mano a mano já começada (Ana × Bia). */
function duel(t: T) {
  const { code } = t.service.create(ana, 's-ana').state;
  t.service.join(code, bia, 's-bia');
  t.service.setReady(ana.userId, true);
  t.service.setReady(bia.userId, true);
  t.service.start(ana.userId);
  return code;
}

/** Quem está na vez e um jogador de cada lado. */
function turnPlayer(t: T): GaudPlayer {
  const s = state(t);
  return players.find((p) => p.userId === s.seats[s.match!.turn]!.userId)!;
}

/** Joga a primeira carta possível de quem está na vez (canta a flor se precisar). */
function playTurn(t: T) {
  const p = turnPlayer(t);
  const hand = handOf(t, p);
  if (hand.actions.calls.includes('flor') && !hand.actions.canPlay) {
    t.service.call(p.userId, 'flor');
    const after = state(t);
    if (after.match?.pending) {
      const other = players.find(
        (x) => x.userId === after.seats[1 - after.match!.pending!.team]!.userId,
      )!;
      t.service.respond(other.userId, false);
    }
    if (state(t).phase !== 'PLAYING') return;
  }
  const fresh = handOf(t, p);
  t.service.playCard(p.userId, fresh.cards[0].id, false);
}

describe('GaudRoomsService — lobby', () => {
  it('cria a mesa mano a mano com o criador no lugar 1', () => {
    const t = setup();
    const snap = t.service.create(ana, 's1');
    expect(snap.mySeat).toBe(0);
    expect(snap.state).toMatchObject({
      phase: 'LOBBY',
      lobbyStatus: 'WAITING_PLAYERS',
      settings: { size: 2, target: 12, flor: true },
      hostId: ana.userId,
    });
    expect(snap.state.seats).toHaveLength(4);
    expect(t.service.roomOf(ana.userId)).toBe(snap.state.code);
  });

  it('com 2 lugares o terceiro não entra; com 4, entram quatro', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    expect(errorCode(() => t.service.join(code, caio, 's3'))).toBe('ROOM_FULL');
    t.service.setSettings(ana.userId, FOUR);
    t.service.join(code, caio, 's3');
    t.service.join(code, duda, 's4');
    expect(state(t).seats.map((s) => s?.team)).toEqual([0, 1, 0, 1]);
    expect(errorCode(() => t.service.join(code, edu, 's5'))).toBe('ROOM_FULL');
    // Voltar para 2 com gente nos lugares 3 e 4 não pode.
    expect(
      errorCode(() => t.service.setSettings(ana.userId, { ...FOUR, size: 2 })),
    ).toBe('INVALID_STATE');
  });

  it('só o anfitrião mexe nas regras, visibilidade e aposta', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    expect(errorCode(() => t.service.setSettings(bia.userId, FOUR))).toBe(
      'NOT_HOST',
    );
    expect(errorCode(() => t.service.setVisibility(bia.userId, false))).toBe(
      'NOT_HOST',
    );
    expect(errorCode(() => t.service.setStake(bia.userId, 80))).toBe(
      'NOT_HOST',
    );
    expect(errorCode(() => t.service.setStake(ana.userId, 7))).toBe(
      'INVALID_PAYLOAD',
    );
    t.service.setReady(bia.userId, true);
    t.service.setStake(ana.userId, 80);
    expect(state(t).stake).toBe(80);
    expect(state(t).seats[1]!.ready).toBe(false);
    t.service.setStake(ana.userId, 80);
    t.service.setVisibility(ana.userId, false);
    expect(t.publisher.publicList()).toEqual([]);
  });

  it('lista mesas públicas com lugar livre', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1', true, FOUR).state;
    t.service.join(code, bia, 's2');
    expect(t.publisher.publicList()).toEqual([
      expect.objectContaining({ code, players: 2, settings: FOUR }),
    ]);
    expect(t.service.stakeToJoin(code, caio.userId)).toBe(state(t).stake);
    expect(t.service.stakeToJoin(code, ana.userId)).toBeNull();
    expect(t.service.stakeCheck(ana.userId).userIds).toHaveLength(2);
  });

  it('troca de lugar só para lugar vago e existente', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1', true, FOUR).state;
    t.service.join(code, bia, 's2');
    expect(errorCode(() => t.service.takeSeat(ana.userId, 1))).toBe(
      'INVALID_STATE',
    );
    t.service.takeSeat(ana.userId, 2);
    expect(state(t).seats[2]!.userId).toBe(ana.userId);
    t.service.setSettings(ana.userId, { ...FOUR, size: 4 });
    const t2 = setup();
    t2.service.create(caio, 's3');
    expect(errorCode(() => t2.service.takeSeat(caio.userId, 3))).toBe(
      'INVALID_STATE',
    );
    expect(code).toBeTruthy();
  });

  it('não começa sem todos prontos, sem a mesa cheia ou por quem não é anfitrião', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    expect(errorCode(() => t.service.start(ana.userId))).toBe(
      'NOT_ENOUGH_PLAYERS',
    );
    t.service.join(code, bia, 's2');
    expect(errorCode(() => t.service.start(bia.userId))).toBe('NOT_HOST');
    expect(errorCode(() => t.service.start(ana.userId))).toBe('INVALID_STATE');
    t.service.setReady(ana.userId, true);
    t.service.setReady(bia.userId, true);
    expect(state(t).lobbyStatus).toBe('READY_TO_START');
    t.service.start(ana.userId);
    expect(state(t).phase).toBe('PLAYING');
    expect(errorCode(() => t.service.join(code, caio, 's3'))).toBe(
      'GAME_IN_PROGRESS',
    );
  });

  it('limita mesas e um usuário por mesa', () => {
    const t = setup({ maxRooms: 1 });
    t.service.create(ana, 's1');
    expect(errorCode(() => t.service.create(bia, 's2'))).toBe('INVALID_STATE');
    expect(errorCode(() => t.service.create(ana, 's1'))).toBe('INVALID_STATE');
    expect(errorCode(() => t.service.join('ZZZZZZ', bia, 's2'))).toBe(
      'NOT_FOUND',
    );
    expect(errorCode(() => t.service.sync(caio.userId))).toBe('NOT_IN_ROOM');
  });
});

describe('GaudRoomsService — partida', () => {
  it('manda a mão de cada um só para o dono', () => {
    const t = setup();
    duel(t);
    const a = handOf(t, ana);
    const b = handOf(t, bia);
    expect(a.cards).toHaveLength(3);
    expect(b.cards).toHaveLength(3);
    expect(a.cards[0].id).not.toBe(b.cards[0].id);
    expect(JSON.stringify(state(t))).not.toContain(a.cards[0].id);
    expect(t.service.sync(ana.userId).hand!.cards).toHaveLength(3);
  });

  it('joga mãos até alguém fechar a partida e acerta a Arena uma vez', () => {
    const t = setup();
    duel(t);
    for (let i = 0; i < 400 && state(t).phase === 'PLAYING'; i++) {
      if (state(t).match!.phase === 'HAND_OVER') t.timer.fire(PAUSE);
      else {
        // Pede truco e corre de vez em quando para a partida andar rápido.
        const p = turnPlayer(t);
        if (handOf(t, p).actions.calls.includes('truco')) {
          t.service.call(p.userId, 'truco');
          const other = p === ana ? bia : ana;
          t.service.respond(other.userId, false);
        } else playTurn(t);
      }
    }
    const s = state(t);
    expect(s.phase).toBe('FINISHED');
    expect(s.result).toMatchObject({ reason: 'points' });
    expect(Math.max(...s.scores)).toBe(12);
    expect(t.arena.settleSafe).toHaveBeenCalledTimes(1);
    expect(t.arena.settleSafe).toHaveBeenCalledWith(
      expect.objectContaining({ game: 'GAUDERIO' }),
    );
    t.service.rematch(bia.userId);
    expect(state(t)).toMatchObject({ phase: 'LOBBY', match: null });
  });

  it('cantos, respostas e ir ao baralho passam pelo serviço', () => {
    const t = setup();
    duel(t);
    const p = turnPlayer(t);
    const other = p === ana ? bia : ana;
    expect(handOf(t, p).actions.calls).toContain('truco');
    t.service.call(p.userId, 'truco');
    t.service.respond(other.userId, true);
    expect(state(t).match!.trucoValue).toBe(2);
    t.service.fold(p.userId);
    expect(state(t).match!.lastHandResult).toMatchObject({
      reason: 'folded',
      points: 2,
    });
    expect(t.publisher.count('gauderio:folded')).toBe(1);
  });

  it('quem sai durante a partida entrega por W.O.', () => {
    const t = setup();
    const code = duel(t);
    t.service.leave(bia.userId);
    expect(state(t)).toMatchObject({
      phase: 'FINISHED',
      result: { winnerTeam: 0, reason: 'abandoned' },
    });
    expect(t.publisher.removed).toContain(`${bia.userId}@${code}`);
    expect(t.arena.settleSafe).toHaveBeenCalledTimes(1);
  });

  it('reconexão segura o lugar; prazo vencido é W.O.', () => {
    const t = setup();
    const code = duel(t);
    t.service.disconnect(bia.userId, 's-other');
    expect(state(t).seats[1]!.connected).toBe(true);
    t.service.disconnect(bia.userId, 's-bia');
    expect(state(t).seats[1]!.connected).toBe(false);
    t.service.join(code, bia, 's-bia2');
    expect(state(t).seats[1]!.connected).toBe(true);
    expect(t.publisher.count('gauderio:player_reconnected')).toBe(1);
    t.service.disconnect(bia.userId, 's-bia2');
    t.timer.fire(GRACE);
    expect(state(t).result).toMatchObject({
      reason: 'abandoned',
      winnerTeam: 0,
    });
  });

  it('o anfitrião passa adiante e a mesa some quando esvazia', () => {
    const t = setup();
    const { code } = t.service.create(ana, 's1').state;
    t.service.join(code, bia, 's2');
    t.service.disconnect(ana.userId, 's1');
    expect(state(t).hostId).toBe(bia.userId);
    t.service.leave(bia.userId);
    t.service.leave(ana.userId);
    expect(t.service.roomOf(ana.userId)).toBeUndefined();
    expect(errorCode(() => t.service.join(code, caio, 's3'))).toBe('NOT_FOUND');
    t.service.disconnect(ana.userId, 's1');
    t.service.onModuleDestroy();
  });
});
