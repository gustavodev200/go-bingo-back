/**
 * Futebol de botão: física compartilhada. O servidor roda a partida com estas funções e o
 * navegador as usa para prever o próprio botão (mesmo código, mesmo resultado).
 *
 * Unidades: pixels do campo e "passos" de 1/60 s (velocidade = px por passo). Origem no centro,
 * x cresce para o gol do time azul, y para baixo. Medidas inspiradas no mapa clássico do HaxBall.
 */

/** Meia largura do campo (linha de fundo em x = ±W). */
export const BOTAO_FIELD_W = 420;
/** Meia altura do campo (laterais em y = ±H). */
export const BOTAO_FIELD_H = 200;
/** Meia largura da boca do gol. */
export const BOTAO_GOAL_H = 64;
/** Profundidade da rede atrás da linha de fundo. */
export const BOTAO_GOAL_DEPTH = 36;
/** Quanto os jogadores podem sair além das linhas. */
export const BOTAO_MARGIN = 40;
export const BOTAO_CENTER_R = 70;
export const BOTAO_POST_R = 8;

export const BOTAO_PLAYER_R = 15;
export const BOTAO_BALL_R = 10;
export const BOTAO_PLAYER_DAMP = 0.96;
export const BOTAO_BALL_DAMP = 0.99;
export const BOTAO_ACCEL = 0.1;
/** Segurando o chute o botão anda mais devagar. */
export const BOTAO_KICK_ACCEL = 0.07;
export const BOTAO_KICK_STRENGTH = 5;
/** Folga entre as bordas para o chute pegar na bola. */
export const BOTAO_KICK_REACH = 4;
export const BOTAO_PLAYER_INV_MASS = 0.5;
export const BOTAO_BALL_INV_MASS = 1;
export const BOTAO_PLAYER_BCOEF = 0.5;
export const BOTAO_BALL_BCOEF = 0.5;

/** Bits da direção: 1 cima, 2 baixo, 4 esquerda, 8 direita. */
export const BOTAO_UP = 1;
export const BOTAO_DOWN = 2;
export const BOTAO_LEFT = 4;
export const BOTAO_RIGHT = 8;

export interface BotaoDisc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  invMass: number;
  bCoef: number;
}

/** Saída de bola: ninguém passa do meio-campo; quem não sai não entra no círculo central. */
export interface BotaoKickoff {
  /** 0 vermelho, 1 azul. */
  kickTeam: number;
}

/** -1 = vermelho defende a esquerda; 1 = azul defende a direita. */
export const botaoSide = (team: number) => (team === 0 ? -1 : 1);

/** Vetor unitário da direção (0 = parado). Cima+baixo ou esquerda+direita se anulam. */
export function botaoDirVector(d: number): [number, number] {
  const x = (d & BOTAO_RIGHT ? 1 : 0) - (d & BOTAO_LEFT ? 1 : 0);
  const y = (d & BOTAO_DOWN ? 1 : 0) - (d & BOTAO_UP ? 1 : 0);
  if (!x && !y) return [0, 0];
  const len = Math.hypot(x, y);
  return [x / len, y / len];
}

/** Bits de direção mais próximos de um vetor qualquer (oito direções; 0 se for curto demais). */
export function botaoDirFromVector(x: number, y: number, deadZone = 0): number {
  if (Math.hypot(x, y) <= deadZone || (!x && !y)) return 0;
  const a = Math.atan2(y, x);
  const oct = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return [
    BOTAO_RIGHT,
    BOTAO_RIGHT | BOTAO_DOWN,
    BOTAO_DOWN,
    BOTAO_DOWN | BOTAO_LEFT,
    BOTAO_LEFT,
    BOTAO_LEFT | BOTAO_UP,
    BOTAO_UP,
    BOTAO_UP | BOTAO_RIGHT,
  ][oct];
}

/** Um passo de movimento do jogador: anda, freia e acelera para onde aponta. */
export function botaoMovePlayer(
  p: BotaoDisc,
  d: number,
  kicking: boolean,
): void {
  p.x += p.vx;
  p.y += p.vy;
  p.vx *= BOTAO_PLAYER_DAMP;
  p.vy *= BOTAO_PLAYER_DAMP;
  const [dx, dy] = botaoDirVector(d);
  const a = kicking ? BOTAO_KICK_ACCEL : BOTAO_ACCEL;
  p.vx += dx * a;
  p.vy += dy * a;
}

export function botaoMoveBall(b: BotaoDisc): void {
  b.x += b.vx;
  b.y += b.vy;
  b.vx *= BOTAO_BALL_DAMP;
  b.vy *= BOTAO_BALL_DAMP;
  if (Math.abs(b.vx) < 1e-3) b.vx = 0;
  if (Math.abs(b.vy) < 1e-3) b.vy = 0;
}

/** Choque elástico entre dois discos (massa inversa 0 = parado, como as traves). true se encostaram. */
export function botaoCollideDiscs(a: BotaoDisc, b: BotaoDisc): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  const sum = a.invMass + b.invMass;
  if (sum === 0) return false;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = d2 ? dx / d : 1;
  const ny = d2 ? dy / d : 0;
  const overlap = rr - d;
  a.x -= nx * overlap * (a.invMass / sum);
  a.y -= ny * overlap * (a.invMass / sum);
  b.x += nx * overlap * (b.invMass / sum);
  b.y += ny * overlap * (b.invMass / sum);
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel < 0) {
    const imp = (-(1 + a.bCoef * b.bCoef) * rel) / sum;
    a.vx -= nx * imp * a.invMass;
    a.vy -= ny * imp * a.invMass;
    b.vx += nx * imp * b.invMass;
    b.vy += ny * imp * b.invMass;
  }
  return true;
}

/** Disco contra um segmento fixo (parede). true se bateu. */
export function botaoCollideSegment(
  d: BotaoDisc,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  bCoef: number,
): boolean {
  const ex = bx - ax;
  const ey = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((d.x - ax) * ex + (d.y - ay) * ey) / (ex * ex + ey * ey)),
  );
  const cx = ax + ex * t;
  const cy = ay + ey * t;
  const dx = d.x - cx;
  const dy = d.y - cy;
  const dist = Math.hypot(dx, dy);
  if (dist >= d.r || dist === 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  d.x = cx + nx * d.r;
  d.y = cy + ny * d.r;
  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) {
    d.vx -= (1 + bCoef) * vn * nx;
    d.vy -= (1 + bCoef) * vn * ny;
  }
  return true;
}

const W = BOTAO_FIELD_W;
const H = BOTAO_FIELD_H;
const G = BOTAO_GOAL_H;
const D = BOTAO_GOAL_DEPTH;

/** Paredes da bola: laterais, linhas de fundo fora da boca do gol e as redes. */
export const BOTAO_BALL_WALLS: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [-W, -H, W, -H],
  [-W, H, W, H],
  [-W, -H, -W, -G],
  [-W, G, -W, H],
  [W, -H, W, -G],
  [W, G, W, H],
  [-W - D, -G, -W - D, G],
  [-W - D, -G, -W, -G],
  [-W - D, G, -W, G],
  [W + D, -G, W + D, G],
  [W, -G, W + D, -G],
  [W, G, W + D, G],
];

export const BOTAO_POSTS: readonly (readonly [number, number])[] = [
  [-W, -G],
  [-W, G],
  [W, -G],
  [W, G],
];

const postDisc = (x: number, y: number): BotaoDisc => ({
  x,
  y,
  vx: 0,
  vy: 0,
  r: BOTAO_POST_R,
  invMass: 0,
  bCoef: 0.5,
});

/** Bola nas paredes e nas traves. Devolve se bateu em alguma trave (som de "na trave!"). */
export function botaoConfineBall(b: BotaoDisc): {
  post: boolean;
  wall: boolean;
} {
  let wall = false;
  for (const [ax, ay, bx, by] of BOTAO_BALL_WALLS)
    if (botaoCollideSegment(b, ax, ay, bx, by, 1)) wall = true;
  let post = false;
  for (const [x, y] of BOTAO_POSTS)
    if (botaoCollideDiscs(postDisc(x, y), b)) post = true;
  return { post, wall };
}

/**
 * Jogador nos limites: a área em volta do campo, as traves e (na saída de bola) o meio-campo
 * e o círculo central.
 */
export function botaoConfinePlayer(
  p: BotaoDisc,
  team: number,
  kickoff: BotaoKickoff | null,
): void {
  for (const [x, y] of BOTAO_POSTS) botaoCollideDiscs(postDisc(x, y), p);
  if (kickoff) {
    const side = botaoSide(team);
    const dist = Math.hypot(p.x, p.y);
    const kicking = kickoff.kickTeam === team;
    const lim = BOTAO_CENTER_R + p.r;
    if (!kicking && dist < lim) {
      const nx = dist > 1e-6 ? p.x / dist : side;
      const ny = dist > 1e-6 ? p.y / dist : 0;
      p.x = nx * lim;
      p.y = ny * lim;
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        p.vx -= vn * nx;
        p.vy -= vn * ny;
      }
    }
    const inCircle =
      kicking && Math.hypot(p.x, p.y) < BOTAO_CENTER_R - p.r * 0.2;
    if (!inCircle && p.x * side < p.r) {
      p.x = side * p.r;
      if (p.vx * side < 0) p.vx = 0;
    }
  }
  const mx = W + BOTAO_MARGIN - p.r;
  const my = H + BOTAO_MARGIN - p.r;
  if (p.x < -mx || p.x > mx) {
    p.x = Math.max(-mx, Math.min(mx, p.x));
    p.vx = 0;
  }
  if (p.y < -my || p.y > my) {
    p.y = Math.max(-my, Math.min(my, p.y));
    p.vy = 0;
  }
}

/** Distância entre as bordas do jogador e da bola. */
export const botaoGap = (p: BotaoDisc, b: BotaoDisc) =>
  Math.hypot(b.x - p.x, b.y - p.y) - p.r - b.r;

/** Chuta se a bola está ao alcance: empurra-a na direção jogador → bola. true se pegou. */
export function botaoKick(p: BotaoDisc, b: BotaoDisc): boolean {
  if (botaoGap(p, b) > BOTAO_KICK_REACH) return false;
  const dx = b.x - p.x;
  const dy = b.y - p.y;
  const d = Math.hypot(dx, dy) || 1;
  b.vx += (dx / d) * BOTAO_KICK_STRENGTH * b.invMass;
  b.vy += (dy / d) * BOTAO_KICK_STRENGTH * b.invMass;
  return true;
}

/** Lado do gol que a bola cruzou por inteiro: 0 = gol na meta do vermelho (ponto do azul), 1 = na do azul. */
export function botaoGoalAt(b: BotaoDisc): number | null {
  if (Math.abs(b.y) >= G) return null;
  if (b.x < -W - b.r) return 0;
  if (b.x > W + b.r) return 1;
  return null;
}

export function botaoNewPlayer(x: number, y: number): BotaoDisc {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r: BOTAO_PLAYER_R,
    invMass: BOTAO_PLAYER_INV_MASS,
    bCoef: BOTAO_PLAYER_BCOEF,
  };
}

export function botaoNewBall(): BotaoDisc {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: BOTAO_BALL_R,
    invMass: BOTAO_BALL_INV_MASS,
    bCoef: BOTAO_BALL_BCOEF,
  };
}
