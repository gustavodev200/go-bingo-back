import type { Arena, Snake } from './arena';

const PROBES = [40, 80, 130, 190];
const TURNS = [0, -0.35, 0.35, -0.7, 0.7, -1.1, 1.1, -1.6, 1.6, -2.2, 2.2];

/** Names the CPU snakes take (all prefixed with "CPU" so nobody mistakes them for people). */
export const SNAKE_BOT_NAMES = [
  'CPU Sucuri',
  'CPU Jiboia',
  'CPU Cascavel',
  'CPU Coral',
  'CPU Jararaca',
  'CPU Caninana',
  'CPU Muçurana',
  'CPU Surucucu',
];

/**
 * Steering of a CPU snake for the next ticks: looks a few body lengths ahead along a fan of
 * headings, drops the ones that run into a body or the wall and, among the safe ones,
 * prefers the one pointing at the richest food nearby. Boosts only to grab a big meal.
 */
export function steerBot(
  arena: Arena,
  s: Snake,
  rng: () => number,
): { angle: number; boost: boolean } {
  const [hx, hy] = s.head;
  const limit = arena.radius - s.radius - 30;

  // Best food in reach: value over distance.
  let foodAngle: number | null = null;
  let foodScore = 0;
  let bigMeal = false;
  const reach = 320;
  arena.forEachFoodIn(hx - reach, hy - reach, hx + reach, hy + reach, (f) => {
    const d = Math.hypot(f.x - hx, f.y - hy);
    if (d < 1 || d > reach) return;
    const score = f.v / (d + 40);
    if (score > foodScore) {
      foodScore = score;
      foodAngle = Math.atan2(f.y - hy, f.x - hx);
      bigMeal = f.v >= 3 && d < 160;
    }
  });

  let best = s.angle;
  let bestScore = -Infinity;
  for (const turn of TURNS) {
    const a = s.angle + turn;
    let danger = 0;
    for (const dist of PROBES) {
      const px = hx + Math.cos(a) * dist;
      const py = hy + Math.sin(a) * dist;
      if (Math.hypot(px, py) > limit) {
        danger += 1000 / dist;
        break;
      }
      arena.forEachBodyNear(px, py, s.radius * 2 + 12, (o, i, bx, by) => {
        if (o === s && i < 12) return;
        if (Math.hypot(bx - px, by - py) < o.radius + s.radius + 8) {
          danger += 1000 / dist;
          return false;
        }
      });
      if (danger > 0) break;
    }
    let score = -danger - Math.abs(turn) * 0.5;
    if (foodAngle !== null) {
      const off = Math.abs(
        Math.atan2(Math.sin(a - foodAngle), Math.cos(a - foodAngle)),
      );
      score += (Math.PI - off) * Math.min(3, foodScore * 40);
    }
    score += (rng() - 0.5) * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  // Too close to the wall: head back to the middle no matter what.
  if (Math.hypot(hx, hy) > limit - 60) best = Math.atan2(-hy, -hx);
  return { angle: best, boost: bigMeal && bestScore > 0 && rng() < 0.3 };
}
