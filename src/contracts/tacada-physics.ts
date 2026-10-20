/**
 * Tacada: física da mesa de bilhar, compartilhada pelo servidor (que decide) e pelo cliente
 * (que só anima a mesma tacada).
 *
 * Determinismo: só soma, subtração, multiplicação, divisão e Math.sqrt (todas exatas no IEEE 754,
 * iguais em qualquer motor JS). Nada de Math.sin/cos/exp aqui dentro: o mesmo estado inicial e a
 * mesma tacada produzem exatamente as mesmas posições no Node, no Chrome e no Safari. O servidor
 * ainda manda as posições finais, então qualquer diferença vira só um ajuste no fim da animação.
 *
 * Mesa: x de 0 a TACADA_TABLE_W (comprimento), y de 0 a TACADA_TABLE_H; unidades arbitrárias.
 */

export const TACADA_TABLE_W = 200;
export const TACADA_TABLE_H = 100;
export const TACADA_BALL_R = 2.6;
/** Bola branca + 15 numeradas: 1–7 lisas, 8 preta, 9–15 listradas. */
export const TACADA_BALLS = 16;
/** Linha de saída: na tacada inicial a branca fica atrás dela (x ≤ isto). */
export const TACADA_KITCHEN_X = 50;
export const TACADA_HEAD_SPOT = { x: 45, y: 50 } as const;
export const TACADA_FOOT_SPOT = { x: 150, y: 50 } as const;
/** Passos de simulação por segundo (fixo: o mesmo no servidor e no cliente). */
export const TACADA_SIM_HZ = 480;
/** Teto de uma tacada (25 s); depois disso tudo para à força. */
export const TACADA_MAX_STEPS = TACADA_SIM_HZ * 25;
/** Velocidade da branca com força máxima (unidades/s). */
export const TACADA_MAX_SPEED = 520;

const R = TACADA_BALL_R;
const D = 2 * R;
const DT = 1 / TACADA_SIM_HZ;
const ROLL_DECEL = 26;
const DAMPING = 0.2;
const STOP_SPEED = 1.2;
const BALL_RESTITUTION = 0.95;
const RAIL_RESTITUTION = 0.76;
/** Quanto do impacto vira avanço (topspin) ou volta (backspin) da branca no primeiro choque. */
const FOLLOW_K = 0.62;
/** Quanto o efeito lateral desvia a branca ao bater na tabela. */
const SIDE_K = 0.35;
const SPIN_DECAY = 0.9;

export interface TacadaPocket {
  x: number;
  y: number;
  r: number;
}

const CORNER_R = 5.4;
const SIDE_R = 4.7;
/** Caçapas: 0 sup-esq, 1 sup-meio, 2 sup-dir, 3 inf-esq, 4 inf-meio, 5 inf-dir. */
export const TACADA_POCKETS: readonly TacadaPocket[] = [
  { x: -1.4, y: -1.4, r: CORNER_R },
  { x: TACADA_TABLE_W / 2, y: -2.6, r: SIDE_R },
  { x: TACADA_TABLE_W + 1.4, y: -1.4, r: CORNER_R },
  { x: -1.4, y: TACADA_TABLE_H + 1.4, r: CORNER_R },
  { x: TACADA_TABLE_W / 2, y: TACADA_TABLE_H + 2.6, r: SIDE_R },
  { x: TACADA_TABLE_W + 1.4, y: TACADA_TABLE_H + 1.4, r: CORNER_R },
];

export interface TacadaRail {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const CORNER_GAP = 7;
const SIDE_GAP = 5.4;
const JAW = 3.2;
const W = TACADA_TABLE_W;
const H = TACADA_TABLE_H;
const MID = W / 2;

/**
 * Tabelas: segmentos retos entre as bocas das caçapas, mais as "mandíbulas" inclinadas que
 * entram em cada caçapa. As pontas dos segmentos também batem (quina da boca).
 */
export const TACADA_RAILS: readonly TacadaRail[] = [
  // Topo, esquerda e direita da caçapa do meio.
  { ax: CORNER_GAP, ay: 0, bx: MID - SIDE_GAP, by: 0 },
  { ax: MID + SIDE_GAP, ay: 0, bx: W - CORNER_GAP, by: 0 },
  // Base.
  { ax: CORNER_GAP, ay: H, bx: MID - SIDE_GAP, by: H },
  { ax: MID + SIDE_GAP, ay: H, bx: W - CORNER_GAP, by: H },
  // Laterais.
  { ax: 0, ay: CORNER_GAP, bx: 0, by: H - CORNER_GAP },
  { ax: W, ay: CORNER_GAP, bx: W, by: H - CORNER_GAP },
  // Mandíbulas das caçapas de canto.
  { ax: CORNER_GAP, ay: 0, bx: CORNER_GAP - JAW, by: -JAW },
  { ax: 0, ay: CORNER_GAP, bx: -JAW, by: CORNER_GAP - JAW },
  { ax: W - CORNER_GAP, ay: 0, bx: W - CORNER_GAP + JAW, by: -JAW },
  { ax: W, ay: CORNER_GAP, bx: W + JAW, by: CORNER_GAP - JAW },
  { ax: CORNER_GAP, ay: H, bx: CORNER_GAP - JAW, by: H + JAW },
  { ax: 0, ay: H - CORNER_GAP, bx: -JAW, by: H - CORNER_GAP + JAW },
  { ax: W - CORNER_GAP, ay: H, bx: W - CORNER_GAP + JAW, by: H + JAW },
  { ax: W, ay: H - CORNER_GAP, bx: W + JAW, by: H - CORNER_GAP + JAW },
  // Mandíbulas das caçapas do meio.
  { ax: MID - SIDE_GAP, ay: 0, bx: MID - SIDE_GAP + 1.2, by: -JAW },
  { ax: MID + SIDE_GAP, ay: 0, bx: MID + SIDE_GAP - 1.2, by: -JAW },
  { ax: MID - SIDE_GAP, ay: H, bx: MID - SIDE_GAP + 1.2, by: H + JAW },
  { ax: MID + SIDE_GAP, ay: H, bx: MID + SIDE_GAP - 1.2, by: H + JAW },
];

/** Posição de uma bola na mesa; null = encaçapada. Índice = número da bola (0 = branca). */
export type TacadaBallPos = readonly [number, number] | null;

export interface TacadaShot {
  /** Direção da tacada (vetor unitário). */
  dirX: number;
  dirY: number;
  /** Força de 0 a 1. */
  power: number;
  /** Efeito lateral (-1 esquerda, 1 direita). */
  spinX: number;
  /** Efeito vertical (-1 puxa / backspin, 1 segue / topspin). */
  spinY: number;
}

export type TacadaSimEvent =
  | { kind: 'ball'; a: number; b: number; speed: number }
  | { kind: 'rail'; ball: number; speed: number }
  | { kind: 'pocket'; ball: number; pocket: number };

export interface TacadaShotOutcome {
  /** Primeira bola numerada que a branca tocou; null = não tocou nenhuma. */
  firstHit: number | null;
  /** Bolas encaçapadas, na ordem em que caíram. */
  pocketed: { ball: number; pocket: number }[];
  /** Alguma bola bateu na tabela depois do primeiro toque da branca. */
  railAfterContact: boolean;
  /** Bolas numeradas diferentes que bateram na tabela na tacada (para a saída). */
  railBalls: number;
  /** Posições finais (arredondadas). */
  balls: TacadaBallPos[];
  /** Passos simulados (duração = steps / TACADA_SIM_HZ s). */
  steps: number;
}

export const isSolid = (ball: number) => ball >= 1 && ball <= 7;
export const isStripe = (ball: number) => ball >= 9 && ball <= 15;

/** Arredonda para 3 casas: o estado da mesa só guarda posições assim, nos dois lados. */
export const roundPos = (v: number) => Math.round(v * 1000) / 1000;

const inside = (x: number, y: number) =>
  x >= R && x <= W - R && y >= R && y <= H - R;

/** A branca pode ser colocada aqui (bola na mão)? Na saída, só atrás da linha de saída. */
export function canPlaceCue(
  balls: readonly TacadaBallPos[],
  x: number,
  y: number,
  kitchenOnly: boolean,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !inside(x, y)) return false;
  if (kitchenOnly && x > TACADA_KITCHEN_X) return false;
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i];
    if (!b) continue;
    const dx = b[0] - x;
    const dy = b[1] - y;
    if (dx * dx + dy * dy < D * D) return false;
  }
  return true;
}

/**
 * Primeiro lugar livre na linha do ponto `spot`, andando para a direita (bola 8 que volta
 * para a mesa, branca reposta).
 */
export function freeSpot(
  balls: readonly TacadaBallPos[],
  spot: { x: number; y: number },
  except = -1,
): [number, number] {
  for (let step = 0; step < 200; step++) {
    const dx = step % 2 === 0 ? step / 2 : -(step + 1) / 2;
    const x = spot.x + dx * 0.5;
    if (x < R || x > W - R) continue;
    let free = true;
    for (let i = 0; i < balls.length && free; i++) {
      const b = balls[i];
      if (!b || i === except) continue;
      const ddx = b[0] - x;
      const ddy = b[1] - spot.y;
      if (ddx * ddx + ddy * ddy < D * D) free = false;
    }
    if (free) return [x, spot.y];
  }
  return [spot.x, spot.y];
}

const SQRT3 = 1.7320508075688772;

/**
 * Triângulo da saída com o ápice no ponto do pé, a 8 no centro e uma lisa e uma listrada nos
 * cantos de trás. `order` são as outras 14 bolas na ordem de montagem (o servidor embaralha).
 */
export function rackBalls(order: readonly number[]): TacadaBallPos[] {
  const balls: TacadaBallPos[] = Array.from(
    { length: TACADA_BALLS },
    () => null,
  );
  balls[0] = [TACADA_HEAD_SPOT.x, TACADA_HEAD_SPOT.y];
  const gap = 0.02;
  const dx = (D + gap) * (SQRT3 / 2);
  let k = 0;
  for (let row = 0; row < 5; row++)
    for (let j = 0; j <= row; j++) {
      const x = TACADA_FOOT_SPOT.x + row * dx;
      const y = TACADA_FOOT_SPOT.y + (j - row / 2) * (D + gap);
      const isEight = row === 2 && j === 1;
      const ball = isEight ? 8 : order[k++];
      balls[ball] = [roundPos(x), roundPos(y)];
    }
  return balls;
}

/** Ordem válida para o triângulo: cantos de trás com uma lisa e uma listrada. */
export function rackOrder(
  random: (min: number, max: number) => number,
): number[] {
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = random(0, i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  // Índices 9 e 13 (contando sem a 8) são os cantos da última fileira.
  const order = [...rest];
  if (isSolid(order[9]) === isSolid(order[13])) {
    const wanted = isSolid(order[9]) ? isStripe : isSolid;
    const from = order.findIndex((b, i) => i !== 9 && i !== 13 && wanted(b));
    [order[13], order[from]] = [order[from], order[13]];
  }
  return order;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  on: boolean;
  moving: boolean;
}

/**
 * Uma tacada em andamento. `step()` avança um passo fixo e devolve o que aconteceu nele
 * (para o cliente tocar sons); `run()` vai até tudo parar.
 */
export class TacadaSim {
  private readonly bodies: Body[];
  private spinX: number;
  private spinY: number;
  private readonly shotDirX: number;
  private readonly shotDirY: number;
  private firstHit: number | null = null;
  private railAfterContact = false;
  private readonly railed = new Set<number>();
  private readonly pocketed: { ball: number; pocket: number }[] = [];
  private stepCount = 0;
  private finished = false;

  constructor(balls: readonly TacadaBallPos[], shot: TacadaShot) {
    this.bodies = balls.map((b) => ({
      x: b ? b[0] : 0,
      y: b ? b[1] : 0,
      vx: 0,
      vy: 0,
      on: b !== null,
      moving: false,
    }));
    const cue = this.bodies[0];
    const power = shot.power < 0 ? 0 : shot.power > 1 ? 1 : shot.power;
    const speed =
      TACADA_MAX_SPEED * (0.03 + 0.97 * power * (0.35 + 0.65 * power));
    cue.vx = shot.dirX * speed;
    cue.vy = shot.dirY * speed;
    cue.moving = cue.on && speed > 0;
    this.shotDirX = shot.dirX;
    this.shotDirY = shot.dirY;
    this.spinX = clamp1(shot.spinX);
    this.spinY = clamp1(shot.spinY);
    if (!cue.moving) this.finished = true;
  }

  get done(): boolean {
    return this.finished;
  }

  get steps(): number {
    return this.stepCount;
  }

  /** Posições atuais (para desenhar), sem arredondar. */
  positions(): TacadaBallPos[] {
    return this.bodies.map((b) => (b.on ? [b.x, b.y] : null));
  }

  step(): TacadaSimEvent[] {
    if (this.finished) return [];
    const events: TacadaSimEvent[] = [];
    const bodies = this.bodies;
    const n = bodies.length;
    this.stepCount++;

    // 1. Anda e freia.
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b.on || !b.moving) continue;
      b.x += b.vx * DT;
      b.y += b.vy * DT;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const next = speed - (ROLL_DECEL + DAMPING * speed) * DT;
      if (next <= STOP_SPEED) {
        b.vx = 0;
        b.vy = 0;
        b.moving = false;
      } else {
        const k = next / speed;
        b.vx *= k;
        b.vy *= k;
      }
    }
    if (this.spinY !== 0 || this.spinX !== 0) {
      const k = 1 - SPIN_DECAY * DT;
      this.spinX *= k;
      this.spinY *= k;
    }

    // 2. Choques entre bolas.
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      if (!a.on) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        if (!b.on || (!a.moving && !b.moving)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D * D || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const overlap = (D - d) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        if (rel <= 0) continue;
        const cueSpeed = i === 0 ? Math.sqrt(a.vx * a.vx + a.vy * a.vy) : 0;
        const imp = ((1 + BALL_RESTITUTION) / 2) * rel;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
        a.moving = true;
        b.moving = true;
        events.push({ kind: 'ball', a: i, b: j, speed: rel });
        if (i === 0 && this.firstHit === null) {
          this.firstHit = j;
          // Efeito vertical: a branca segue (topspin) ou volta (backspin) na linha da tacada.
          if (this.spinY !== 0) {
            const f = this.spinY * FOLLOW_K * cueSpeed;
            a.vx += this.shotDirX * f;
            a.vy += this.shotDirY * f;
            this.spinY = 0;
          }
        }
      }
    }

    // 3. Tabelas e caçapas.
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (!b.on || !b.moving) continue;
      for (const rail of TACADA_RAILS) {
        const hit = this.collideRail(b, rail);
        if (hit > 0) {
          events.push({ kind: 'rail', ball: i, speed: hit });
          if (this.firstHit !== null) this.railAfterContact = true;
          if (i > 0) this.railed.add(i);
          if (i === 0 && this.spinX !== 0) this.sideSpin(b, rail);
        }
      }
      const pocket = this.pocketOf(b);
      if (pocket >= 0) {
        b.on = false;
        b.moving = false;
        b.vx = 0;
        b.vy = 0;
        this.pocketed.push({ ball: i, pocket });
        events.push({ kind: 'pocket', ball: i, pocket });
      }
    }

    let moving = false;
    for (let i = 0; i < n && !moving; i++)
      if (bodies[i].on && bodies[i].moving) moving = true;
    if (!moving || this.stepCount >= TACADA_MAX_STEPS) this.finished = true;
    return events;
  }

  /** Simula até o fim. */
  run(): TacadaShotOutcome {
    while (!this.finished) this.step();
    return this.outcome();
  }

  outcome(): TacadaShotOutcome {
    return {
      firstHit: this.firstHit,
      pocketed: this.pocketed.map((p) => ({ ...p })),
      railAfterContact: this.railAfterContact,
      railBalls: this.railed.size,
      balls: this.bodies.map((b) =>
        b.on ? ([roundPos(b.x), roundPos(b.y)] as const) : null,
      ),
      steps: this.stepCount,
    };
  }

  /** Devolve a velocidade normal do choque (0 = não bateu). */
  private collideRail(b: Body, r: TacadaRail): number {
    const ex = r.bx - r.ax;
    const ey = r.by - r.ay;
    const len2 = ex * ex + ey * ey;
    let t = ((b.x - r.ax) * ex + (b.y - r.ay) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = r.ax + ex * t;
    const cy = r.ay + ey * t;
    const dx = b.x - cx;
    const dy = b.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R * R || d2 === 0) return 0;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    b.x = cx + nx * R;
    b.y = cy + ny * R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return 0;
    b.vx -= (1 + RAIL_RESTITUTION) * vn * nx;
    b.vy -= (1 + RAIL_RESTITUTION) * vn * ny;
    return -vn;
  }

  /** Efeito lateral: na tabela, a branca ganha velocidade ao longo dela. */
  private sideSpin(b: Body, r: TacadaRail): void {
    const ex = r.bx - r.ax;
    const ey = r.by - r.ay;
    const len = Math.sqrt(ex * ex + ey * ey);
    const tx = ex / len;
    const ty = ey / len;
    // Sentido "direita" de quem tacou: perpendicular à direção da tacada.
    const rx = -this.shotDirY;
    const ry = this.shotDirX;
    const sign = rx * tx + ry * ty >= 0 ? 1 : -1;
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    const f = this.spinX * SIDE_K * speed * sign;
    b.vx += tx * f;
    b.vy += ty * f;
    this.spinX *= 0.5;
  }

  private pocketOf(b: Body): number {
    for (let p = 0; p < TACADA_POCKETS.length; p++) {
      const pk = TACADA_POCKETS[p];
      const dx = b.x - pk.x;
      const dy = b.y - pk.y;
      if (dx * dx + dy * dy < pk.r * pk.r) return p;
    }
    // Escapou da mesa por uma fresta: cai na caçapa mais próxima.
    if (b.x < -R || b.x > W + R || b.y < -R || b.y > H + R) {
      let best = 0;
      let bestD = Infinity;
      for (let p = 0; p < TACADA_POCKETS.length; p++) {
        const pk = TACADA_POCKETS[p];
        const d = (b.x - pk.x) ** 2 + (b.y - pk.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    }
    return -1;
  }
}

const clamp1 = (v: number) =>
  !Number.isFinite(v) ? 0 : v < -1 ? -1 : v > 1 ? 1 : v;

/** Atalho: simula a tacada inteira. */
export function simulateShot(
  balls: readonly TacadaBallPos[],
  shot: TacadaShot,
): TacadaShotOutcome {
  return new TacadaSim(balls, shot).run();
}

export interface TacadaAimPreview {
  /** Onde a branca encosta (bola fantasma) ou bate na tabela. */
  x: number;
  y: number;
  /** Bola que seria atingida; null = vai direto na tabela. */
  ball: number | null;
  /** Direção que a bola atingida toma (vetor unitário), se houver. */
  objDirX: number;
  objDirY: number;
  /** Direção da branca depois do choque (sem efeito). */
  cueDirX: number;
  cueDirY: number;
}

/** Linha de mira: primeira bola ou tabela no caminho da branca. */
export function aimPreview(
  balls: readonly TacadaBallPos[],
  dirX: number,
  dirY: number,
): TacadaAimPreview | null {
  const cue = balls[0];
  if (!cue) return null;
  const [cx, cy] = cue;
  let bestT = Infinity;
  let hit: number | null = null;
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i];
    if (!b) continue;
    const ox = b[0] - cx;
    const oy = b[1] - cy;
    const proj = ox * dirX + oy * dirY;
    if (proj <= 0) continue;
    const perp2 = ox * ox + oy * oy - proj * proj;
    if (perp2 >= D * D) continue;
    const t = proj - Math.sqrt(D * D - perp2);
    if (t < bestT) {
      bestT = t;
      hit = i;
    }
  }
  // Tabela (caixa interna onde o centro da bola pode andar).
  let railT = Infinity;
  if (dirX > 0) railT = Math.min(railT, (W - R - cx) / dirX);
  if (dirX < 0) railT = Math.min(railT, (R - cx) / dirX);
  if (dirY > 0) railT = Math.min(railT, (H - R - cy) / dirY);
  if (dirY < 0) railT = Math.min(railT, (R - cy) / dirY);
  if (hit === null || railT < bestT) {
    const t = Math.max(0, railT);
    return {
      x: cx + dirX * t,
      y: cy + dirY * t,
      ball: null,
      objDirX: 0,
      objDirY: 0,
      cueDirX: 0,
      cueDirY: 0,
    };
  }
  const gx = cx + dirX * bestT;
  const gy = cy + dirY * bestT;
  const target = balls[hit]!;
  let ox = target[0] - gx;
  let oy = target[1] - gy;
  const ol = Math.sqrt(ox * ox + oy * oy) || 1;
  ox /= ol;
  oy /= ol;
  // A branca sai perpendicular à linha do choque (bolas de mesma massa).
  const dot = dirX * ox + dirY * oy;
  let tx = dirX - ox * dot;
  let ty = dirY - oy * dot;
  const tl = Math.sqrt(tx * tx + ty * ty);
  if (tl > 1e-6) {
    tx /= tl;
    ty /= tl;
  } else {
    tx = 0;
    ty = 0;
  }
  return {
    x: gx,
    y: gy,
    ball: hit,
    objDirX: ox,
    objDirY: oy,
    cueDirX: tx,
    cueDirY: ty,
  };
}
