import {
  BOTAO_BALL_R,
  BOTAO_FIELD_W,
  BOTAO_GOAL_H,
  BOTAO_KICK_REACH,
  BOTAO_PLAYER_R,
  botaoDirFromVector,
  botaoGap,
  botaoSide,
} from '../../contracts';
import type { BotaoMatch, MatchInput, MatchPlayer } from './match';

/** O que a CPU lembra entre um tick e outro. */
export interface BotMemory {
  /** Ticks até decidir de novo (tempo de reação). */
  wait?: number;
  d?: number;
  k?: boolean;
  /** Canto do gol que está mirando nesta jogada. */
  aimY?: number;
}

const unit = (x: number, y: number): [number, number] => {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
};

/**
 * CPU simples: o mais perto da bola do time ataca (contorna a bola, alinha com o gol e chuta);
 * os outros ficam entre a bola e o próprio gol e afastam quando ela chega perto.
 */
export function botThink(match: BotaoMatch, p: MatchPlayer): MatchInput {
  const ai = p.ai;
  if ((ai.wait ?? 0) > 0) {
    ai.wait!--;
    return { d: ai.d ?? 0, k: ai.k ?? false };
  }
  ai.wait = 1 + Math.floor(match.rand() * 2);
  const next = decide(match, p);
  ai.d = next.d;
  ai.k = next.k;
  return next;
}

function decide(match: BotaoMatch, p: MatchPlayer): MatchInput {
  if (match.phase !== 'play' && match.phase !== 'kickoff')
    return { d: 0, k: false };
  if (match.phase === 'kickoff' && match.kickTeam !== p.team)
    return { d: 0, k: false };

  const ball = match.ball;
  const mates = match.players.filter((q) => q.team === p.team);
  const dist = (q: MatchPlayer) =>
    Math.hypot(q.disc.x - ball.x, q.disc.y - ball.y);
  const closest = mates.reduce((a, b) => (dist(b) < dist(a) ? b : a), p);
  return closest === p ? attack(match, p) : defend(match, p);
}

function attack(match: BotaoMatch, p: MatchPlayer): MatchInput {
  const me = p.disc;
  const ball = match.ball;
  const ai = p.ai;
  const atk = -botaoSide(p.team);
  if (ai.aimY === undefined || match.rand() < 0.01)
    ai.aimY = (match.rand() * 2 - 1) * (BOTAO_GOAL_H - 18);

  // Onde a bola vai estar daqui a pouco.
  const bx = ball.x + ball.vx * 6;
  const by = ball.y + ball.vy * 6;
  const [ux, uy] = unit(atk * BOTAO_FIELD_W - bx, ai.aimY - by);
  const rx = me.x - bx;
  const ry = me.y - by;
  const along = rx * ux + ry * uy;
  const lateral = rx * -uy + ry * ux;
  const reach = BOTAO_BALL_R + BOTAO_PLAYER_R;

  let tx: number;
  let ty: number;
  if (along < -reach * 0.6 && Math.abs(lateral) < 9) {
    // Alinhado atrás da bola: vai com tudo.
    tx = bx + ux * 30;
    ty = by + uy * 30;
  } else if (along > -reach * 0.6) {
    // Na frente ou do lado: contorna pelo lado em que já está.
    const sign = lateral >= 0 ? 1 : -1;
    tx = bx - ux * (reach + 14) + -uy * sign * (reach + 10);
    ty = by - uy * (reach + 14) + ux * sign * (reach + 10);
  } else {
    tx = bx - ux * (reach + 4);
    ty = by - uy * (reach + 4);
  }

  const [kx, ky] = unit(ball.x - me.x, ball.y - me.y);
  const facing = kx * ux + ky * uy;
  const k = botaoGap(me, ball) <= BOTAO_KICK_REACH + 1 && facing > 0.75;
  return { d: botaoDirFromVector(tx - me.x, ty - me.y, 3), k };
}

function defend(match: BotaoMatch, p: MatchPlayer): MatchInput {
  const me = p.disc;
  const ball = match.ball;
  const ownX = botaoSide(p.team) * BOTAO_FIELD_W;
  const tx = ownX + (ball.x - ownX) * 0.3;
  const ty = Math.max(
    -BOTAO_GOAL_H - 20,
    Math.min(BOTAO_GOAL_H + 20, ball.y * 0.45),
  );
  const [kx] = unit(ball.x - me.x, ball.y - me.y);
  const clearing = kx * -botaoSide(p.team) > 0.3;
  const k = botaoGap(me, ball) <= BOTAO_KICK_REACH + 1 && clearing;
  // Bola perto do gol: sai para afastar.
  if (Math.abs(ball.x - ownX) < BOTAO_FIELD_W * 0.55 && clearing)
    return {
      d: botaoDirFromVector(ball.x - me.x, ball.y - me.y, 3),
      k,
    };
  return { d: botaoDirFromVector(tx - me.x, ty - me.y, 6), k };
}
