import {
  canPlaceCue,
  freeSpot,
  simulateShot,
  TACADA_BALL_R,
  TACADA_FOOT_SPOT,
  TACADA_HEAD_SPOT,
  TACADA_KITCHEN_X,
  TACADA_POCKETS,
  TACADA_TABLE_H,
  TACADA_TABLE_W,
  tacadaGroupOf,
  type TacadaBallPos,
  type TacadaGroup,
} from '../../contracts';
import type { RandomInt } from '../../core/random';
import type { Announcement, TacadaMatch, TacadaShotInput } from './match';

const D = TACADA_BALL_R * 2;
/** Most shots it actually simulates per turn (keeps the event loop free). */
const MAX_SIMS = 36;

interface Candidate extends TacadaShotInput {
  /** Geometric guess (cut angle, distances) used to pick what to simulate. */
  guess: number;
}

/** Balls the shooter may legally hit first. */
function targets(
  balls: readonly TacadaBallPos[],
  group: TacadaGroup | null,
  onEight: boolean,
): number[] {
  const out: number[] = [];
  for (let b = 1; b < balls.length; b++) {
    if (!balls[b]) continue;
    if (onEight ? b === 8 : b !== 8 && (!group || tacadaGroupOf(b) === group))
      out.push(b);
  }
  return out;
}

/** Ghost-ball aims: for each target and pocket, where the cue must hit it. */
function aims(
  cue: readonly [number, number],
  balls: readonly TacadaBallPos[],
  legal: readonly number[],
): Candidate[] {
  const out: Candidate[] = [];
  for (const b of legal) {
    const [tx, ty] = balls[b]!;
    TACADA_POCKETS.forEach((p, pocket) => {
      const px = p.x - tx;
      const py = p.y - ty;
      const toPocket = Math.hypot(px, py);
      const ux = px / toPocket;
      const uy = py / toPocket;
      const gx = tx - ux * D;
      const gy = ty - uy * D;
      const ax = gx - cue[0];
      const ay = gy - cue[1];
      const toGhost = Math.hypot(ax, ay);
      if (toGhost < 0.5) return;
      const dirX = ax / toGhost;
      const dirY = ay / toGhost;
      const cut = dirX * ux + dirY * uy; // 1 = straight in
      if (cut < 0.25) return;
      out.push({
        dirX,
        dirY,
        power: 0,
        spinX: 0,
        spinY: 0,
        pocket,
        guess: cut * 2 - (toPocket + toGhost) / 150,
      });
    });
  }
  return out.sort((a, b) => b.guess - a.guess);
}

/** Where to drop the cue with ball in hand: behind the easiest pot, else a free spot. */
function placeCue(
  balls: readonly TacadaBallPos[],
  legal: readonly number[],
  kitchen: boolean,
): [number, number] {
  if (kitchen) {
    for (let dy = 0; dy < 40; dy += 3)
      for (const y of [TACADA_HEAD_SPOT.y + dy, TACADA_HEAD_SPOT.y - dy])
        if (canPlaceCue(balls, TACADA_HEAD_SPOT.x, y, true))
          return [TACADA_HEAD_SPOT.x, y];
    return [TACADA_KITCHEN_X - 10, TACADA_HEAD_SPOT.y];
  }
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (const b of legal) {
    const [tx, ty] = balls[b]!;
    for (const p of TACADA_POCKETS) {
      const ux = (p.x - tx) / Math.hypot(p.x - tx, p.y - ty);
      const uy = (p.y - ty) / Math.hypot(p.x - tx, p.y - ty);
      for (const k of [14, 22, 32]) {
        const x = tx - ux * (D + k);
        const y = ty - uy * (D + k);
        if (!canPlaceCue(balls, x, y, false)) continue;
        const score = -Math.hypot(p.x - tx, p.y - ty) - k / 2;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
  }
  if (best) return best;
  for (let x = 20; x < TACADA_TABLE_W - 10; x += 7)
    for (let y = 10; y < TACADA_TABLE_H - 10; y += 7)
      if (canPlaceCue(balls, x, y, false)) return [x, y];
  return [TACADA_HEAD_SPOT.x, TACADA_HEAD_SPOT.y];
}

/** How good a simulated result is for the shooter. */
function score(
  shot: Candidate,
  balls: readonly TacadaBallPos[],
  group: TacadaGroup | null,
  onEight: boolean,
  legal: ReadonlySet<number>,
): number {
  const o = simulateShot(balls, shot);
  const pocketed = o.pocketed.map((p) => p.ball);
  if (pocketed.includes(0) || o.firstHit === null || !legal.has(o.firstHit))
    return -100;
  const eight = o.pocketed.find((p) => p.ball === 8);
  if (eight)
    return onEight && eight.pocket === shot.pocket && !pocketed.includes(0)
      ? 1000
      : -1000;
  let s = 0;
  for (const b of pocketed) {
    if (!group) s += 10;
    else s += tacadaGroupOf(b) === group ? 10 : -4;
  }
  if (pocketed.length === 0 && !o.railAfterContact) s -= 50; // no-rail foul
  return s + shot.guess;
}

/**
 * One shot of a CPU seat: breaks hard from the kitchen, places the cue behind the easiest
 * pot when it has ball in hand, then simulates the best ghost-ball aims (with the same
 * deterministic physics the table uses) and takes the one that pots the most of its group
 * without fouling; a little aim noise keeps it beatable.
 */
export function tacadaBotTurn(
  match: TacadaMatch,
  seat: number,
  random: RandomInt,
): Announcement[] {
  const view = match.publicView();
  if (view.turn !== seat) return [];
  const balls = view.balls.map((b) =>
    b ? ([b[0], b[1]] as const) : null,
  ) as TacadaBallPos[];
  const group = view.groups[seat];
  const legal = targets(balls, group, view.onEight);
  const legalSet = new Set(legal);

  if (view.breakShot) {
    const [cx, cy] = placeCue(balls, legal, true);
    const dx = TACADA_FOOT_SPOT.x - cx;
    const dy = TACADA_FOOT_SPOT.y - cy + (random(0, 5) - 2) * 0.2;
    return match.shoot(seat, {
      dirX: dx,
      dirY: dy,
      power: 1,
      spinX: 0,
      spinY: 0,
      cueX: cx,
      cueY: cy,
    });
  }

  let placed: [number, number] | undefined;
  if (view.ballInHand) {
    placed = placeCue(balls, legal, false);
    balls[0] = placed;
  } else if (!balls[0]) balls[0] = freeSpot(balls, TACADA_HEAD_SPOT);
  const cue = balls[0];

  const candidates = aims(cue, balls, legal).slice(0, MAX_SIMS / 2);
  // Fallbacks: straight at each legal ball.
  for (const b of legal) {
    const [tx, ty] = balls[b]!;
    const len = Math.hypot(tx - cue[0], ty - cue[1]);
    if (len > 0.5)
      candidates.push({
        dirX: (tx - cue[0]) / len,
        dirY: (ty - cue[1]) / len,
        power: 0,
        spinX: 0,
        spinY: 0,
        pocket: 0,
        guess: -1,
      });
  }

  let best: Candidate | null = null;
  let bestScore = -Infinity;
  let sims = 0;
  for (const c of candidates) {
    for (const power of [0.45, 0.7]) {
      if (sims++ >= MAX_SIMS) break;
      const shot = { ...c, power };
      const s = score(shot, balls, group, view.onEight, legalSet);
      if (s > bestScore) {
        bestScore = s;
        best = shot;
      }
    }
  }
  if (!best)
    best = {
      dirX: 1,
      dirY: 0,
      power: 0.5,
      spinX: 0,
      spinY: 0,
      pocket: 0,
      guess: 0,
    };

  // Human-like error: a fraction of a degree, more on long shots.
  const angle = ((random(0, 21) - 10) / 10) * 0.03;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const input: TacadaShotInput = {
    dirX: best.dirX * cos - best.dirY * sin,
    dirY: best.dirX * sin + best.dirY * cos,
    power: best.power,
    spinX: 0,
    spinY: 0,
  };
  if (view.onEight) input.pocket = best.pocket;
  if (placed) {
    input.cueX = placed[0];
    input.cueY = placed[1];
  }
  return match.shoot(seat, input);
}
