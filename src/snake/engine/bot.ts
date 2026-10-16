import {
  SNAKE_BASE_SPEED,
  SNAKE_BOOST_SPEED,
  SNAKE_MIN_BOOST_MASS,
} from '../../contracts';
import { wrapAngle, type Arena, type Food, type Snake } from './arena';

export const SNAKE_BOT_NAMES = [
  'Viper',
  'Naja',
  'Jiboia',
  'Sucuri',
  'Cascavel',
  'Mamba',
  'Coral',
  'Píton',
  'Anaconda',
  'Kobra',
  'Slinky',
  'Noodle',
  'Zigzag',
  'Neon',
  'Turbo',
  'Faísca',
  'Minhocão',
  'Serpentina',
  'Rabisco',
  'Laço',
  'Spaghetti',
  'Rattle',
  'Hiss',
  'Fang',
  'Venom',
  'Sombra',
  'Raio',
  'Tufão',
  'Pixel',
  'Glitch',
];

/** Directions tried around the current heading, closest first. */
const FAN = [
  0,
  -0.35,
  0.35,
  -0.7,
  0.7,
  -1.1,
  1.1,
  -1.6,
  1.6,
  -2.2,
  2.2,
  Math.PI,
];

/** 0 = clear; higher = something (body, wall, a head on its way) closer along that direction. */
function danger(arena: Arena, s: Snake, angle: number, speed: number): number {
  const r = s.radius;
  const reach = speed * 0.9 + r * 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [hx, hy] = s.head;
  const STEPS = 6;
  for (let k = 1; k <= STEPS; k++) {
    const d = (reach * k) / STEPS;
    const x = hx + cos * d;
    const y = hy + sin * d;
    if (Math.hypot(x, y) + r * 2 > arena.radius) return 1.2 / k;
    let hit = false;
    arena.forEachBodyNear(x, y, r + 50, (o, _i, px, py) => {
      if (o === s) return;
      const rr = r + o.radius + 10;
      if ((px - x) ** 2 + (py - y) ** 2 < rr * rr) {
        hit = true;
        return false;
      }
    });
    if (hit) return 1 / k;
    const t = d / speed;
    for (const o of arena.snakes.values()) {
      if (o === s) continue;
      const ox = o.head[0] + Math.cos(o.angle) * SNAKE_BASE_SPEED * t;
      const oy = o.head[1] + Math.sin(o.angle) * SNAKE_BASE_SPEED * t;
      const rr = r + o.radius + 30;
      if ((ox - x) ** 2 + (oy - y) ** 2 < rr * rr) return 0.8 / k;
    }
  }
  return 0;
}

function pickFood(arena: Arena, s: Snake): Food | null {
  const [hx, hy] = s.head;
  let best: Food | null = null;
  let score = 0;
  arena.forEachFoodIn(hx - 380, hy - 380, hx + 380, hy + 380, (f) => {
    const d = Math.hypot(f.x - hx, f.y - hy);
    const ahead = Math.cos(wrapAngle(Math.atan2(f.y - hy, f.x - hx) - s.angle));
    const sc = (f.v * (1.4 + ahead)) / (d + 60);
    if (sc > score) {
      score = sc;
      best = f;
    }
  });
  return best;
}

/** Smaller head nearby worth cutting off, or null. */
function pickPrey(
  arena: Arena,
  s: Snake,
): { prey: Snake; dist: number } | null {
  const [hx, hy] = s.head;
  let prey: Snake | null = null;
  let dist = 320;
  for (const o of arena.snakes.values()) {
    if (o === s || o.mass * 1.3 > s.mass) continue;
    const d = Math.hypot(o.head[0] - hx, o.head[1] - hy);
    if (d < dist) {
      dist = d;
      prey = o;
    }
  }
  return prey ? { prey, dist } : null;
}

/** CPU brain: chases food, sometimes hunts smaller heads, always steers away from danger. */
export function snakeBotThink(arena: Arena, s: Snake): void {
  const rnd = arena.rng;
  const b = (s.brain ??= {
    food: null,
    retarget: 0,
    wander: s.angle,
    aggro: 0,
    boostUntil: 0,
    skill: 0.6 + rnd() * 0.4,
  });
  const [hx, hy] = s.head;
  const t = arena.tick;

  if (t >= b.retarget || (b.food && !arena.foods.has(b.food.id))) {
    b.retarget = t + 10 + Math.floor(rnd() * 10);
    b.food = pickFood(arena, s);
    if (!b.food && rnd() < 0.3)
      b.wander = wrapAngle(b.wander + (rnd() - 0.5) * 2);
    if (Math.hypot(hx, hy) > arena.radius * 0.7)
      b.wander = Math.atan2(-hy, -hx) + (rnd() - 0.5);
  }

  let desired = b.food ? Math.atan2(b.food.y - hy, b.food.x - hx) : b.wander;
  let boost = false;

  if (s.mass > 60 && rnd() < 0.008 * b.skill) b.aggro = t + 40;
  if (t < b.aggro) {
    const hunt = pickPrey(arena, s);
    if (hunt) {
      const { prey, dist } = hunt;
      const lead = 90 + prey.radius * 3;
      desired = Math.atan2(
        prey.head[1] + Math.sin(prey.angle) * lead - hy,
        prey.head[0] + Math.cos(prey.angle) * lead - hx,
      );
      boost = dist < 260 && s.mass > SNAKE_MIN_BOOST_MASS + 30;
    }
  }
  if (
    b.food &&
    b.food.v >= 4 &&
    s.mass > 80 &&
    Math.hypot(b.food.x - hx, b.food.y - hy) < 220 &&
    rnd() < 0.05
  )
    b.boostUntil = t + 12;
  if (t < b.boostUntil) boost = true;

  let bestA = desired;
  let bestScore = -Infinity;
  let ahead = 0;
  for (const off of FAN) {
    const a = wrapAngle(s.angle + off);
    const dz = danger(
      arena,
      s,
      a,
      boost ? SNAKE_BOOST_SPEED : SNAKE_BASE_SPEED,
    );
    if (off === 0) ahead = dz;
    if (
      off === 0 &&
      dz === 0 &&
      Math.abs(wrapAngle(desired - s.angle)) < 0.35
    ) {
      bestA = desired;
      break;
    }
    const sc =
      -Math.abs(wrapAngle(desired - a)) * 0.6 -
      dz * 30 * b.skill -
      Math.abs(off) * 0.05;
    if (sc > bestScore) {
      bestScore = sc;
      bestA = a;
    }
  }
  if (boost && ahead > 0) boost = false;
  // Escape burst when something is right in front.
  if (
    ahead >= 0.5 &&
    s.mass > SNAKE_MIN_BOOST_MASS + 10 &&
    rnd() < 0.3 * b.skill
  )
    boost = true;

  s.target = bestA;
  s.wantBoost = boost;
}
