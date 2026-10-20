import {
  DEFAULT_INF_RULES,
  INF_BUTTON,
  INF_COLS,
  INF_CRITICAL_TIME,
  INF_FIX_PANELS,
  INF_INTRO_TIME,
  INF_ROOMS,
  INF_ROWS,
  INF_STATIONS,
  INF_TASK_INFO,
  INF_TICK_RATE,
  INF_VENTS,
  infLineOfSight,
  infMaxImpostors,
  infMove,
  infRayLength,
  isInfFloor,
  type InfRules,
} from '../../contracts';
import { DomainError } from '../../core/domain-error';
import { findPath } from './bot';
import { InfMatch, type MatchPlayer } from './match';

/** Deterministic PRNG (mulberry32). */
function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seats = (n: number, bot = false) =>
  Array.from({ length: n }, (_, seat) => ({ seat, bot }));

function playing(
  n = 5,
  rules: Partial<InfRules> = {},
  impostors = 1,
  seed = 3,
): InfMatch {
  const m = new InfMatch(
    seats(n),
    { ...DEFAULT_INF_RULES, ...rules },
    impostors,
    seeded(seed),
  );
  m.phase = 'play';
  return m;
}

const all = (m: InfMatch) => [...m.players.values()];
const impostor = (m: InfMatch) => all(m).find((p) => p.role === 'impostor')!;
const crew = (m: InfMatch) => all(m).filter((p) => p.role === 'crew');
const place = (p: MatchPlayer, x: number, y: number) => {
  p.x = x;
  p.y = y;
};
const ticks = (m: InfMatch, seconds: number) => {
  for (let i = 0; i < Math.ceil(seconds * INF_TICK_RATE); i++) m.tick();
};

describe('Estação Abissal map', () => {
  it('puts every console, vent, panel and the button on the floor', () => {
    const points = [
      ...INF_STATIONS,
      ...INF_VENTS,
      ...Object.values(INF_FIX_PANELS).flat(),
      INF_BUTTON,
    ];
    for (const p of points)
      expect(isInfFloor(Math.floor(p.x), Math.floor(p.y))).toBe(true);
  });

  it('connects every room to the Átrio', () => {
    for (const r of INF_ROOMS) {
      const path = findPath(INF_BUTTON.x, INF_BUTTON.y, r.x + 1.5, r.y + 1.5);
      const end = path[path.length - 1];
      expect(end).toEqual({ x: r.x + 1.5, y: r.y + 1.5 });
      expect(path.length).toBeGreaterThan(0);
    }
  });

  it('keeps the map closed (border is solid)', () => {
    for (let x = 0; x < INF_COLS; x++) {
      expect(isInfFloor(x, 0)).toBe(false);
      expect(isInfFloor(x, INF_ROWS - 1)).toBe(false);
    }
  });

  it('vent links are symmetric', () => {
    for (const v of INF_VENTS)
      for (const to of v.links) expect(INF_VENTS[to].links).toContain(v.id);
  });
});

describe('movement and sight', () => {
  it('slides along walls and never enters them', () => {
    const p = { x: 25, y: 15 }; // Átrio, top-left corner area
    for (let i = 0; i < 100; i++) infMove(p, -1, -1, 0.05);
    // Stops within one sub-step of the corner, never inside.
    expect(p.x).toBeGreaterThanOrEqual(24.3);
    expect(p.x).toBeLessThan(24.45);
    expect(p.y).toBeGreaterThanOrEqual(14.3);
    expect(p.y).toBeLessThan(14.45);
  });

  it('ghosts pass through walls', () => {
    const p = { x: 25, y: 15 };
    for (let i = 0; i < 20; i++) infMove(p, -1, 0, 0.05, true);
    expect(p.x).toBeLessThan(24);
  });

  it('walls block the line of sight', () => {
    expect(infLineOfSight(26, 16, 38, 22)).toBe(true);
    expect(infLineOfSight(32, 19, 32, 5)).toBe(true); // straight up the hall
    expect(infLineOfSight(26, 16, 8, 6)).toBe(false);
    expect(infRayLength(32.5, 19, -Math.PI / 2, 30)).toBeCloseTo(17, 1); // up to the Laboratório wall
    expect(infRayLength(32.5, 19, -Math.PI / 2, 5)).toBe(5);
  });
});

describe('InfMatch setup', () => {
  it('deals the asked number of infiltrators and tasks', () => {
    const m = new InfMatch(
      seats(10),
      { ...DEFAULT_INF_RULES, tasks: 4 },
      2,
      seeded(7),
    );
    expect(all(m).filter((p) => p.role === 'impostor')).toHaveLength(2);
    for (const p of all(m)) {
      expect(p.tasks).toHaveLength(4);
      expect(new Set(p.tasks.map((t) => t.station)).size).toBe(4);
    }
    expect(infMaxImpostors(6)).toBe(1);
    expect(infMaxImpostors(9)).toBe(2);
    expect(infMaxImpostors(15)).toBe(3);
  });

  it('starts with the intro, then play', () => {
    const m = new InfMatch(seats(4), DEFAULT_INF_RULES, 1, seeded());
    expect(m.phase).toBe('intro');
    ticks(m, INF_INTRO_TIME + 0.1);
    expect(m.phase).toBe('play');
  });
});

describe('secrecy', () => {
  it('never tells a crewmate who the infiltrator is', () => {
    const m = playing(6);
    const c = crew(m)[0];
    const f = m.frameFor(c.seat);
    expect(f.me.role).toBe('crew');
    expect(f.me.mates).toEqual([]);
    expect(f.players.every((p) => (p[5] & 2) === 0)).toBe(true);
  });

  it('shows infiltrators their partners', () => {
    const m = playing(9, {}, 2);
    const imps = all(m).filter((p) => p.role === 'impostor');
    const f = m.frameFor(imps[0].seat);
    expect(f.me.mates).toEqual([imps[1].seat]);
    expect(f.players.find((p) => p[0] === imps[1].seat)?.[5]).toBe(2);
  });

  it('hides players out of sight and behind walls', () => {
    const m = playing(4);
    const [a, b] = crew(m);
    place(a, 30, 19);
    place(b, 8, 6); // Hidroponia
    expect(m.frameFor(a.seat).players.map((p) => p[0])).not.toContain(b.seat);
    place(b, 33, 19);
    expect(m.frameFor(a.seat).players.map((p) => p[0])).toContain(b.seat);
  });

  it('ghosts see everybody; the living never see ghosts', () => {
    const m = playing(5);
    const [a, b] = crew(m);
    b.alive = false;
    place(a, 30, 19);
    place(b, 31, 19);
    expect(m.frameFor(a.seat).players.map((p) => p[0])).not.toContain(b.seat);
    place(a, 8, 6);
    expect(m.frameFor(b.seat).players.map((p) => p[0])).toContain(a.seat);
  });

  it('lights out shrinks crew vision only', () => {
    const m = playing(5);
    const imp = impostor(m);
    const [a] = crew(m);
    m.sabotage = { kind: 'lights', left: null, fixed: [0] };
    place(a, 26, 19);
    place(imp, 30, 19);
    expect(m.sees(a, imp.x, imp.y)).toBe(false);
    expect(m.sees(imp, a.x, a.y)).toBe(true);
  });
});

describe('kills, reports and meetings', () => {
  it('kills a nearby crewmate, leaves a body and starts the cooldown', () => {
    const m = playing(5);
    const imp = impostor(m);
    const [v] = crew(m);
    imp.killCd = 0;
    place(imp, 30, 19);
    place(v, 31, 19);
    m.act(imp.seat, { t: 'kill', target: v.seat });
    expect(v.alive).toBe(false);
    expect(m.bodies).toEqual([{ seat: v.seat, x: 31, y: 19 }]);
    expect(imp.killCd).toBe(DEFAULT_INF_RULES.killCooldown);
    expect(m.frameFor(v.seat).events).toEqual([{ k: 'killed', by: imp.seat }]);
  });

  it('refuses kills on cooldown, out of range or by the crew', () => {
    const m = playing(5);
    const imp = impostor(m);
    const [v, w] = crew(m);
    place(imp, 30, 19);
    place(v, 31, 19);
    expect(() => m.act(imp.seat, { t: 'kill', target: v.seat })).toThrow(
      DomainError,
    );
    imp.killCd = 0;
    place(v, 36, 19);
    expect(() => m.act(imp.seat, { t: 'kill', target: v.seat })).toThrow(
      DomainError,
    );
    place(w, 30, 20);
    expect(() => m.act(w.seat, { t: 'kill', target: v.seat })).toThrow(
      DomainError,
    );
  });

  it('a report opens a meeting that votes someone out', () => {
    const m = playing(6, { discussionTime: 0 });
    const imp = impostor(m);
    const [v, r, ...rest] = crew(m);
    imp.killCd = 0;
    place(imp, 30, 19);
    place(v, 31, 19);
    m.act(imp.seat, { t: 'kill', target: v.seat });
    place(r, 32, 19);
    m.act(r.seat, { t: 'report', body: v.seat });
    expect(m.phase).toBe('meeting');
    expect(m.meeting!.stage).toBe('vote');
    expect(m.meeting!.voters).not.toContain(v.seat);
    expect(m.bodies).toEqual([]);

    m.act(r.seat, { t: 'vote', target: imp.seat });
    for (const p of rest) m.act(p.seat, { t: 'vote', target: imp.seat });
    m.act(imp.seat, { t: 'vote', target: r.seat });
    expect(m.meeting!.stage).toBe('result');
    expect(m.frameFor(r.seat).meeting!.votes).toHaveLength(5);
    ticks(m, 4.1);
    expect(m.phase).toBe('eject');
    expect(m.eject).toEqual({
      seat: imp.seat,
      tie: false,
      wasImpostor: true,
      impostorsLeft: 0,
    });
    ticks(m, 6.1);
    expect(m.phase).toBe('over');
    expect(m.result).toEqual({ winner: 'crew', reason: 'votes' });
  });

  it('a tie ejects nobody and play resumes', () => {
    const m = playing(5, { discussionTime: 0 });
    const ps = all(m);
    place(ps[0], INF_BUTTON.x, INF_BUTTON.y);
    m.buttonCd = 0;
    m.act(ps[0].seat, { t: 'emergency' });
    expect(ps[0].meetingsLeft).toBe(0);
    m.act(ps[0].seat, { t: 'vote', target: ps[1].seat });
    m.act(ps[1].seat, { t: 'vote', target: ps[0].seat });
    m.act(ps[2].seat, { t: 'vote', target: -1 });
    m.act(ps[3].seat, { t: 'vote', target: -1 });
    m.act(ps[4].seat, { t: 'vote', target: ps[1].seat });
    ticks(m, 4.1);
    expect(m.eject).toMatchObject({ seat: null, tie: true });
    ticks(m, 6.1);
    expect(m.phase).toBe('play');
    expect(all(m).every((p) => p.alive)).toBe(true);
  });

  it('hides the role of the ejected when confirmEjects is off', () => {
    const m = playing(5, { discussionTime: 0, confirmEjects: false });
    const c = crew(m);
    m.buttonCd = 0;
    place(c[0], INF_BUTTON.x, INF_BUTTON.y);
    m.act(c[0].seat, { t: 'emergency' });
    for (const p of all(m)) m.act(p.seat, { t: 'vote', target: c[1].seat });
    ticks(m, 4.1);
    expect(m.eject).toEqual({
      seat: c[1].seat,
      tie: false,
      wasImpostor: null,
      impostorsLeft: null,
    });
  });

  it('the button is locked during a critical sabotage', () => {
    const m = playing(5);
    const c = crew(m)[0];
    m.buttonCd = 0;
    m.sabotage = { kind: 'oxygen', left: 30, fixed: [0, 0] };
    place(c, INF_BUTTON.x, INF_BUTTON.y);
    expect(() => m.act(c.seat, { t: 'emergency' })).toThrow('Emergência');
  });

  it('infiltrators win when they match the crew', () => {
    const m = playing(4);
    const imp = impostor(m);
    const [a, b] = crew(m);
    imp.killCd = 0;
    place(imp, 30, 19);
    place(a, 31, 19);
    m.act(imp.seat, { t: 'kill', target: a.seat });
    expect(m.phase).toBe('play');
    imp.killCd = 0;
    place(b, 30, 20);
    m.act(imp.seat, { t: 'kill', target: b.seat });
    expect(m.result).toEqual({ winner: 'impostor', reason: 'kills' });
  });
});

describe('tasks', () => {
  it('needs the console open long enough, then counts toward the bar', () => {
    const m = playing(4, { tasks: 2 });
    const c = crew(m)[0];
    const st = INF_STATIONS[c.tasks[0].station];
    place(c, st.x, st.y + 0.5);
    if (!isInfFloor(Math.floor(c.x), Math.floor(c.y)))
      place(c, st.x, st.y - 0.5);
    expect(() => m.act(c.seat, { t: 'task_done', station: st.id })).toThrow(
      DomainError,
    );
    m.act(c.seat, { t: 'task_open', station: st.id });
    expect(() => m.act(c.seat, { t: 'task_done', station: st.id })).toThrow(
      'Rápido',
    );
    m.t += INF_TASK_INFO[st.type].minMs / 1000;
    m.act(c.seat, { t: 'task_done', station: st.id });
    expect(c.tasks[0].done).toBe(true);
    expect(m.frameFor(c.seat).taskBar).toBeCloseTo(1 / 6, 2);
  });

  it('the crew wins when every task is done (ghosts included)', () => {
    const m = playing(4, { tasks: 2 });
    for (const p of crew(m)) for (const t of p.tasks) t.done = true;
    const last = crew(m)[0];
    last.alive = false;
    last.tasks[1].done = false;
    const st = INF_STATIONS[last.tasks[1].station];
    place(last, st.x, st.y);
    m.act(last.seat, { t: 'task_open', station: st.id });
    m.t += 10;
    m.act(last.seat, { t: 'task_done', station: st.id });
    expect(m.result).toEqual({ winner: 'crew', reason: 'tasks' });
  });

  it('infiltrators cannot do tasks', () => {
    const m = playing(4);
    const imp = impostor(m);
    expect(() =>
      m.act(imp.seat, { t: 'task_open', station: imp.tasks[0].station }),
    ).toThrow('fingem');
  });
});

describe('sabotage and vents', () => {
  it('an unfixed critical sabotage wins it for the infiltrators', () => {
    const m = playing(5);
    const imp = impostor(m);
    m.sabotageCd = 0;
    m.act(imp.seat, { t: 'sabotage', kind: 'oxygen' });
    expect(() => m.act(imp.seat, { t: 'sabotage', kind: 'lights' })).toThrow(
      DomainError,
    );
    ticks(m, INF_CRITICAL_TIME + 0.2);
    expect(m.result).toEqual({ winner: 'impostor', reason: 'sabotage' });
  });

  it('oxygen needs both panels', () => {
    const m = playing(5);
    const [a] = crew(m);
    m.sabotageCd = 0;
    m.act(impostor(m).seat, { t: 'sabotage', kind: 'oxygen' });
    const [p0, p1] = INF_FIX_PANELS.oxygen;
    place(a, p0.x, p0.y);
    m.act(a.seat, { t: 'fix', panel: 0 });
    expect(m.sabotage?.fixed).toEqual([1, 0]);
    place(a, p1.x, p1.y);
    m.act(a.seat, { t: 'fix', panel: 1 });
    expect(m.sabotage).toBeNull();
  });

  it('the reactor needs two hands at once', () => {
    const m = playing(5);
    const [a, b] = crew(m);
    m.sabotageCd = 0;
    m.act(impostor(m).seat, { t: 'sabotage', kind: 'reactor' });
    const [p0, p1] = INF_FIX_PANELS.reactor;
    place(a, p0.x, p0.y);
    place(b, p1.x, p1.y);
    m.act(a.seat, { t: 'hold', panel: 0, on: true });
    m.tick();
    expect(m.sabotage?.fixed).toEqual([1, 0]);
    m.act(b.seat, { t: 'hold', panel: 1, on: true });
    m.tick();
    expect(m.sabotage).toBeNull();
  });

  it('infiltrators travel through linked vents unseen', () => {
    const m = playing(5);
    const imp = impostor(m);
    const [c] = crew(m);
    const v = INF_VENTS[4];
    place(imp, v.x, v.y);
    place(c, v.x - 1, v.y);
    m.act(imp.seat, { t: 'vent_enter' });
    expect(m.frameFor(c.seat).players.map((p) => p[0])).not.toContain(imp.seat);
    m.act(imp.seat, { t: 'vent_move', to: 3 });
    expect([imp.x, imp.y]).toEqual([INF_VENTS[3].x, INF_VENTS[3].y]);
    expect(() => m.act(imp.seat, { t: 'vent_move', to: 0 })).toThrow(
      DomainError,
    );
    m.act(imp.seat, { t: 'vent_exit' });
    expect(imp.vent).toBe(-1);
    expect(() => m.act(c.seat, { t: 'vent_enter' })).toThrow(DomainError);
  });
});

describe('input, chat and leaving', () => {
  it('moves by queued inputs and echoes the last sequence', () => {
    const m = playing(4);
    const p = all(m)[0];
    const x0 = p.x;
    m.pushInput(p.seat, { s: 7, x: 1, y: 0 });
    m.tick();
    expect(p.x).toBeGreaterThan(x0);
    expect(m.frameFor(p.seat).me.lastSeq).toBe(7);
  });

  it('the living chat only in meetings; ghost talk stays among ghosts', () => {
    const m = playing(5);
    const [a, b] = crew(m);
    expect(() => m.say(a.seat, 'oi')).toThrow(DomainError);
    b.alive = false;
    m.say(b.seat, 'fui eu? não');
    expect(m.chatFor(a.seat)).toEqual([]);
    expect(m.chatFor(b.seat)).toHaveLength(1);
  });

  it('a leaving infiltrator hands the win to the crew', () => {
    const m = playing(5);
    m.remove(impostor(m).seat);
    expect(m.result).toEqual({ winner: 'crew', reason: 'left' });
  });

  it('a voter leaving mid-vote closes the ballot when everyone else voted', () => {
    const m = playing(5, { discussionTime: 0 });
    const ps = all(m);
    m.buttonCd = 0;
    place(ps[0], INF_BUTTON.x, INF_BUTTON.y);
    m.act(ps[0].seat, { t: 'emergency' });
    const leaver = crew(m).find((p) => p.seat !== ps[0].seat)!;
    for (const p of ps)
      if (p !== leaver) m.act(p.seat, { t: 'vote', target: -1 });
    m.remove(leaver.seat);
    expect(m.meeting?.stage).toBe('result');
  });
});

describe('CPU players', () => {
  it.each([1, 2, 3, 4, 5])(
    'play a whole match to the end (seed %i)',
    (seed) => {
      const m = new InfMatch(
        seats(8, true),
        {
          ...DEFAULT_INF_RULES,
          discussionTime: 5,
          votingTime: 15,
          killCooldown: 15,
        },
        2,
        seeded(seed),
      );
      for (let i = 0; i < 20 * 60 * 15 && m.phase !== 'over'; i++) m.tick();
      expect(m.phase).toBe('over');
      expect(m.result).not.toBeNull();
      for (const p of all(m))
        if (p.alive)
          expect(isInfFloor(Math.floor(p.x), Math.floor(p.y))).toBe(true);
    },
  );
});
