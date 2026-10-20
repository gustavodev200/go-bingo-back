import {
  INF_COLS,
  INF_FIX_PANELS,
  INF_KILL_RANGE,
  INF_REPORT_RANGE,
  INF_ROWS,
  INF_SABOTAGES,
  INF_SABOTAGE_INFO,
  INF_STATIONS,
  INF_TASK_INFO,
  INF_USE_RANGE,
  INF_VISION_CREW,
  infDist,
  infLineOfSight,
  isInfFloor,
} from '../../contracts';
import type { InfMatch, MatchPlayer } from './match';

type Goal =
  | { kind: 'task'; station: number }
  | { kind: 'wander'; station: number }
  | { kind: 'fix'; panel: number }
  | { kind: 'body'; seat: number }
  | { kind: 'chase'; seat: number };

export interface BotMemory {
  /** Seat this CPU saw killing someone: its vote at the next meeting. */
  suspect?: number;
  goal?: Goal;
  path?: { x: number; y: number }[];
  /** Match time when the bot finishes what it is doing at the goal. */
  busyUntil?: number;
  /** Fake tasks an infiltrator bot already "did". */
  fake?: number[];
  /** Lights sabotage the bot already decided about. */
  lightsSeen?: boolean;
  stuckAt?: number;
  lastX?: number;
  lastY?: number;
}

const ARRIVE = 0.15;
const key = (x: number, y: number) => y * INF_COLS + x;

/** Shortest walkable route between two points (BFS over the floor tiles). */
export function findPath(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
): { x: number; y: number }[] {
  const start = key(Math.floor(fx), Math.floor(fy));
  const goalX = Math.floor(tx);
  const goalY = Math.floor(ty);
  const goal = key(goalX, goalY);
  const prev = new Int32Array(INF_COLS * INF_ROWS).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length && prev[goal] < 0; head++) {
    const cur = queue[head];
    const cx = cur % INF_COLS;
    const cy = (cur - cx) / INF_COLS;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isInfFloor(nx, ny)) continue;
      const k = key(nx, ny);
      if (prev[k] >= 0) continue;
      prev[k] = cur;
      queue.push(k);
    }
  }
  if (prev[goal] < 0) return [{ x: tx, y: ty }];
  const tiles: number[] = [];
  for (let k = goal; k !== start; k = prev[k]) tiles.push(k);
  tiles.reverse();
  const path = tiles.map((k) => ({
    x: (k % INF_COLS) + 0.5,
    y: Math.floor(k / INF_COLS) + 0.5,
  }));
  path[path.length - 1] = { x: tx, y: ty };
  // Drop waypoints that a straight walk already covers (smoother, more human paths).
  const out: { x: number; y: number }[] = [];
  let from = { x: fx, y: fy };
  for (let i = 0; i < path.length; i++) {
    const next = path[i + 1];
    if (next && clearWalk(from.x, from.y, next.x, next.y)) continue;
    out.push(path[i]);
    from = path[i];
  }
  return out;
}

/** A straight walk with some margin for the body (three parallel sight lines). */
function clearWalk(ax: number, ay: number, bx: number, by: number): boolean {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / len) * 0.35;
  const ny = ((bx - ax) / len) * 0.35;
  return (
    infLineOfSight(ax, ay, bx, by) &&
    infLineOfSight(ax + nx, ay + ny, bx + nx, by + ny) &&
    infLineOfSight(ax - nx, ay - ny, bx - nx, by - ny)
  );
}

function goalPoint(
  match: InfMatch,
  goal: Goal,
): { x: number; y: number } | null {
  switch (goal.kind) {
    case 'task':
    case 'wander': {
      const st = INF_STATIONS[goal.station];
      // Stand just off the console, never inside the wall behind it.
      return standSpot(st.x, st.y);
    }
    case 'fix': {
      const kind = match.sabotage?.kind;
      if (!kind) return null;
      const pos = INF_FIX_PANELS[kind][goal.panel];
      return pos ? standSpot(pos.x, pos.y) : null;
    }
    case 'body': {
      const b = match.bodies.find((x) => x.seat === goal.seat);
      return b ? { x: b.x, y: b.y } : null;
    }
    case 'chase': {
      const v = match.player(goal.seat);
      return v && v.alive && !v.gone ? { x: v.x, y: v.y } : null;
    }
  }
}

function standSpot(x: number, y: number): { x: number; y: number } {
  if (isInfFloor(Math.floor(x), Math.floor(y))) return { x, y };
  for (const [dx, dy] of [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ])
    if (isInfFloor(Math.floor(x + dx), Math.floor(y + dy)))
      return { x: x + dx * 0.8, y: y + dy * 0.8 };
  return { x, y };
}

function setGoal(p: MatchPlayer, goal: Goal | undefined): void {
  p.ai.goal = goal;
  p.ai.path = undefined;
  p.ai.busyUntil = undefined;
}

/** Walks toward the goal; true when standing on it. */
function walk(
  match: InfMatch,
  p: MatchPlayer,
  target: { x: number; y: number },
): boolean {
  const ai = p.ai;
  if (!p.alive) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= ARRIVE) return true;
    match.step(p, dx / d, dy / d);
    return false;
  }
  if (!ai.path) ai.path = findPath(p.x, p.y, target.x, target.y);
  let next = ai.path[0];
  while (next && infDist(p.x, p.y, next.x, next.y) <= ARRIVE) {
    ai.path.shift();
    next = ai.path[0];
  }
  if (!next) return true;
  const dx = next.x - p.x;
  const dy = next.y - p.y;
  const d = Math.hypot(dx, dy);
  // Slow down for the last bit so the bot lands on the point.
  const k = Math.min(1, d / 0.2);
  match.step(p, (dx / d) * k, (dy / d) * k);
  // Pushed against a corner for a second: plan again.
  if (
    ai.lastX !== undefined &&
    Math.abs(ai.lastX - p.x) + Math.abs((ai.lastY ?? 0) - p.y) < 0.01
  ) {
    ai.stuckAt ??= match.t;
    if (match.t - ai.stuckAt > 1) {
      ai.path = undefined;
      ai.stuckAt = undefined;
    }
  } else ai.stuckAt = undefined;
  ai.lastX = p.x;
  ai.lastY = p.y;
  return false;
}

function pickNextTask(
  match: InfMatch,
  p: MatchPlayer,
  rand: () => number,
): Goal {
  if (p.role === 'crew') {
    const todo = p.tasks.filter((t) => !t.done);
    // People stroll around between tasks; so do the CPUs (and that gives the infiltrators a chance).
    if (todo.length && rand() < 0.25)
      return {
        kind: 'wander',
        station: Math.floor(rand() * INF_STATIONS.length),
      };
    if (todo.length) {
      // Nearest first, like most people do.
      todo.sort(
        (a, b) =>
          infDist(
            p.x,
            p.y,
            INF_STATIONS[a.station].x,
            INF_STATIONS[a.station].y,
          ) -
          infDist(
            p.x,
            p.y,
            INF_STATIONS[b.station].x,
            INF_STATIONS[b.station].y,
          ),
      );
      return { kind: 'task', station: todo[0].station };
    }
  } else {
    const fake = p.ai.fake ?? [];
    const todo = p.tasks.filter((t) => !fake.includes(t.station));
    if (todo.length)
      return {
        kind: 'task',
        station: todo[Math.floor(rand() * todo.length)].station,
      };
  }
  return { kind: 'wander', station: Math.floor(rand() * INF_STATIONS.length) };
}

/** Crewmates the infiltrator bot could be seen by if it struck now. */
function witnesses(
  match: InfMatch,
  killer: MatchPlayer,
  victim: MatchPlayer,
): number {
  let n = 0;
  for (const q of match.players.values()) {
    if (
      q === killer ||
      q === victim ||
      q.gone ||
      !q.alive ||
      q.role === 'impostor'
    )
      continue;
    // People notice everything in sight; CPUs only what happens right next to them.
    const reach = q.bot ? 4.5 : INF_VISION_CREW + 0.5;
    if (
      infDist(q.x, q.y, killer.x, killer.y) <= reach &&
      infLineOfSight(q.x, q.y, killer.x, killer.y)
    )
      n++;
  }
  return n;
}

function tryKill(match: InfMatch, p: MatchPlayer): boolean {
  if (p.role !== 'impostor' || !p.alive || p.killCd > 0) return false;
  for (const v of match.players.values()) {
    if (v.gone || !v.alive || v.role === 'impostor' || v.vent >= 0) continue;
    if (
      infDist(p.x, p.y, v.x, v.y) > INF_KILL_RANGE - 0.1 ||
      !infLineOfSight(p.x, p.y, v.x, v.y)
    )
      continue;
    if (witnesses(match, p, v) > 0) continue;
    match.kill(p, v.seat);
    setGoal(p, {
      kind: 'wander',
      station: Math.floor((p.x * 7 + p.y * 13) % INF_STATIONS.length),
    });
    return true;
  }
  return false;
}

/** A lone crewmate in sight worth stalking. */
function preyInSight(match: InfMatch, p: MatchPlayer): MatchPlayer | null {
  for (const v of match.players.values()) {
    if (v.gone || !v.alive || v.role === 'impostor') continue;
    if (!match.sees(p, v.x, v.y)) continue;
    if (witnesses(match, p, v) === 0) return v;
  }
  return null;
}

/**
 * One tick of a CPU player: fixes critical sabotages, reports bodies it sees,
 * does its tasks (or fakes them), and as an infiltrator stalks lone targets and
 * sabotages now and then.
 */
export function botThink(
  match: InfMatch,
  p: MatchPlayer,
  rand: () => number,
): void {
  const ai = p.ai;
  const sab = match.sabotage;

  if (
    p.role === 'impostor' &&
    !sab &&
    match.sabotageCd <= 0 &&
    rand() < 0.004
  ) {
    const kind = INF_SABOTAGES[Math.floor(rand() * INF_SABOTAGES.length)];
    match.sabotageStart(p, kind);
    return;
  }

  if (p.alive) {
    if (tryKill(match, p)) return;

    // Emergencies first.
    if (
      sab &&
      INF_SABOTAGE_INFO[sab.kind].critical &&
      ai.goal?.kind !== 'fix'
    ) {
      const panels = INF_FIX_PANELS[sab.kind];
      let panel = p.seat % panels.length;
      if (sab.kind === 'oxygen') {
        const open = panels.map((_, i) => i).filter((i) => !sab.fixed[i]);
        open.sort(
          (a, b) =>
            infDist(p.x, p.y, panels[a].x, panels[a].y) -
            infDist(p.x, p.y, panels[b].x, panels[b].y),
        );
        panel = open[0] ?? panel;
      }
      setGoal(p, { kind: 'fix', panel });
    } else if (sab?.kind === 'lights' && !ai.lightsSeen) {
      ai.lightsSeen = true;
      if (p.role === 'crew' && rand() < 0.5)
        setGoal(p, { kind: 'fix', panel: 0 });
    }
    if (!sab) ai.lightsSeen = false;
    if (ai.goal?.kind === 'fix' && !sab) setGoal(p, undefined);

    if (
      p.role === 'crew' &&
      ai.goal?.kind !== 'body' &&
      ai.goal?.kind !== 'fix'
    ) {
      const body = match.bodies.find((b) => match.sees(p, b.x, b.y));
      if (body) {
        setGoal(p, { kind: 'body', seat: body.seat });
        // Whoever is standing next to the body looks guilty.
        let near: MatchPlayer | null = null;
        for (const q of match.players.values()) {
          if (
            q === p ||
            q.gone ||
            !q.alive ||
            q.vent >= 0 ||
            !match.sees(p, q.x, q.y)
          )
            continue;
          if (
            infDist(q.x, q.y, body.x, body.y) <= 3.5 &&
            (!near ||
              infDist(q.x, q.y, body.x, body.y) <
                infDist(near.x, near.y, body.x, body.y))
          )
            near = q;
        }
        if (near && ai.suspect === undefined) ai.suspect = near.seat;
      }
    }

    if (
      p.role === 'impostor' &&
      p.killCd <= 2 &&
      ai.goal?.kind !== 'fix' &&
      ai.goal?.kind !== 'chase'
    ) {
      const prey = preyInSight(match, p);
      if (prey) setGoal(p, { kind: 'chase', seat: prey.seat });
    }
  } else if (p.role === 'impostor') return; // ghost infiltrators just sabotage

  if (!ai.goal) setGoal(p, pickNextTask(match, p, rand));
  const goal = ai.goal!;
  const target = goalPoint(match, goal);
  if (!target) return setGoal(p, undefined);

  if (goal.kind === 'chase') {
    // Re-plan as the prey moves.
    if (
      !ai.path ||
      ai.path.length === 0 ||
      infDist(
        ai.path[ai.path.length - 1].x,
        ai.path[ai.path.length - 1].y,
        target.x,
        target.y,
      ) > 1.5
    )
      ai.path = undefined;
    walk(match, p, target);
    if (p.killCd > 2 || !match.sees(p, target.x, target.y))
      setGoal(p, undefined);
    return;
  }

  if (!walk(match, p, target)) {
    if (
      goal.kind === 'body' &&
      infDist(p.x, p.y, target.x, target.y) <= INF_REPORT_RANGE - 0.4
    )
      match.report(p, goal.seat);
    return;
  }

  switch (goal.kind) {
    case 'body':
      match.report(p, goal.seat);
      return;
    case 'fix': {
      if (!sab) return setGoal(p, undefined);
      if (sab.kind === 'reactor') {
        if (p.holding !== goal.panel) match.hold(p, goal.panel, true);
        return;
      }
      ai.busyUntil ??= match.t + (sab.kind === 'lights' ? 1.5 : 2.5);
      if (match.t >= ai.busyUntil) {
        if (!sab.fixed[goal.panel]) match.fix(p, goal.panel);
        setGoal(p, undefined);
      }
      return;
    }
    case 'task': {
      const st = INF_STATIONS[goal.station];
      if (ai.busyUntil === undefined) {
        ai.busyUntil =
          match.t + INF_TASK_INFO[st.type].minMs / 1000 + 2 + rand() * 4;
        if (p.role === 'crew') {
          if (infDist(p.x, p.y, st.x, st.y) > INF_USE_RANGE)
            return setGoal(p, { kind: 'wander', station: goal.station });
          match.taskOpen(p, goal.station);
        }
      }
      if (match.t < ai.busyUntil) return;
      if (p.role === 'crew') match.taskDone(p, goal.station);
      else ai.fake = [...(ai.fake ?? []), goal.station];
      setGoal(p, undefined);
      return;
    }
    case 'wander':
      ai.busyUntil ??= match.t + 1 + rand() * 3;
      if (match.t >= ai.busyUntil) setGoal(p, undefined);
      return;
  }
}

/**
 * The CPU's ballot: waits a bit, then follows the most voted suspect (never a
 * fellow infiltrator) or skips. Returns undefined while still "thinking".
 */
export function botVote(
  match: InfMatch,
  p: MatchPlayer,
  votes: ReadonlyMap<number, number>,
  left: number,
  total: number,
  rand: () => number,
): number | undefined {
  const humansPending = [...(match.meeting?.voters ?? [])].some((s) => {
    const q = match.player(s);
    return q && !q.bot && !votes.has(s);
  });
  const suspect = p.ai.suspect;
  if (
    p.role === 'crew' &&
    suspect !== undefined &&
    match.meeting?.voters.includes(suspect)
  )
    return suspect;
  if (humansPending && left > total * 0.35 && rand() > 0.01) return undefined;
  const tally = new Map<number, number>();
  for (const target of votes.values())
    if (target >= 0) tally.set(target, (tally.get(target) ?? 0) + 1);
  let best = -1;
  let bestCount = 0;
  for (const [target, count] of tally) {
    if (target === p.seat) continue;
    if (p.role === 'impostor' && match.player(target)?.role === 'impostor')
      continue;
    if (count > bestCount) {
      best = target;
      bestCount = count;
    }
  }
  // Follow a strong lead; a single accusation only convinces some.
  return bestCount >= 2 || (bestCount === 1 && rand() < 0.5) ? best : -1;
}
