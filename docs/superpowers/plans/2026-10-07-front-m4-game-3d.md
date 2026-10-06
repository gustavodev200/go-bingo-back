# Go Bingo Front — M4 (Partida 3D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a região de palco da tela de jogo numa cena 3D (globo que solta a bola, telão com painel 1–75, plateia com destaque "por 1", cena de vitória), com sons sintetizados e mudo, sem regressão no modo 2D.

**Architecture:** Mesmo padrão do M3: regras em módulos puros testados (`telao.ts`, `globe.ts`, `camera.ts`, `choreographer.ts`, `pose.ts`, `sound/sfx.ts`) e componentes R3F que só desenham. O telão é uma `CanvasTexture` desenhada por `drawTelao(ctx, view)`. A partida tem Canvas próprio (`GameStage`), montado via `next/dynamic` dentro da `GameView` (prop `stage`); a configuração de Canvas comum (qualidade, perda de contexto) sai do `LobbyStage` para `StageCanvas`. Sons: `sfxFor(prev, next, me)` decide; um player WebAudio toca notas sintetizadas.

**Tech Stack:** Next.js 16, React 19.2, three 0.186, @react-three/fiber 9.8, @react-three/drei 10.7, Zustand 5, WebAudio, Vitest.

**Spec:** [docs/superpowers/specs/2026-10-07-m4-game-3d-design.md](../specs/2026-10-07-m4-game-3d-design.md) · PRD E4/§4.2/§4.3 · M3: [2026-10-07-front-m3-lobby-3d.md](2026-10-07-front-m3-lobby-3d.md)

## Global Constraints

- Só `go-bingo-front`; **nenhuma** mudança no back nem em `src/contracts/`.
- A HUD mostra o número sorteado imediatamente (store); toda animação 3D é cosmética. `LastNumbers` (com `aria-live`) continua no DOM em ambos os modos.
- Estado por frame só em refs/matrizes (nunca store/`useState`); poses e decisões são funções puras de tempo em **ms**.
- three/R3F/drei só em `src/features/game/scene3d/` e carregados via `next/dynamic` (`check:bundle` precisa continuar verde).
- Sem arquivos de áudio/modelos/texturas novos.
- Primeiro snapshot (entrar/recarregar) não toca som nem anima bola.
- Textos em pt-BR; apelidos no 3D só como texto (`drawTelao` usa `fillText`; `<Text>` do drei).
- Cobertura ≥ 80%; exclusão continua só para `src/features/game/scene3d/**/*.tsx`.
- Preservar final de linha (LF/CRLF) dos arquivos existentes ao editar.
- Branch `feat/front-m4-game-3d` a partir de `main`; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Reconexão/recarga no meio da partida** (snapshot com 40 números) → nenhum som, nenhuma bola voando; telão já mostra o estado. Testes: Task 3 (`first snapshot is silent`), Task 4/R3F (bola só anima quando `drawCount` aumenta com a cena montada — verificação manual).
2. **Número repetido / evento duplicado** (`game:number_drawn` duas vezes) → um único som; telão sem duplicata (a store já ignora). Teste: Task 3 (`sfxFor` não toca sem aumento).
3. **Mudo** → nada toca, inclusive a fanfarra; persiste após recarregar; storage bloqueado não quebra. Testes: Task 3.
4. **Vencedor desconectado ou que já saiu** → cena não quebra (sem foco se o boneco não está na cena); telão mostra o apelido do `winner` da store. Teste: Task 1 (`telaoView` usa o apelido do winner), Task 2 (winner fora dos membros não cria avatar).
5. **Modo 2D** → partida igual ao M1 + "Painel" e som; resultado imediato. Testes: Task 5.

---

## File Structure

```
src/features/game/
  scene3d/telao.ts · telao.test.ts            Task 1
  scene3d/globe.ts · globe.test.ts            Task 1
  scene3d/camera.ts · camera.test.ts          Task 1 (MODIFY)
  scene3d/pose.ts · pose.test.ts              Task 2 (MODIFY)
  scene3d/choreographer.ts · .test.ts         Task 2 (MODIFY)
  scene3d/use-avatar-states.ts · .test.tsx    Task 2 (MODIFY)
  sound/sfx.ts · sfx.test.ts                  Task 3
  sound/sfx-player.ts · sfx-player.test.ts    Task 3
  sound/use-muted.ts · use-muted.test.tsx     Task 3
  sound/use-game-sounds.ts · .test.tsx        Task 3
  scene3d/stage-canvas.tsx                    Task 4 (extraído do lobby-stage)
  scene3d/telao.tsx · globe.tsx               Task 4
  scene3d/hall.tsx · camera-rig.tsx · avatar-crowd.tsx · lobby-stage.tsx   Task 4 (MODIFY)
  scene3d/game-stage.tsx · game-stage-lazy.tsx Task 4
  drawn-board.tsx · .test.tsx                 Task 5
  sound-toggle.tsx · .test.tsx                Task 5
  game-view.tsx · .test.tsx                   Task 5 (MODIFY)
  room-screen.tsx · .test.tsx                 Task 5 (MODIFY)
README.md · docs/.../roadmap.md (+ back)      Task 6
```

---

### Task 1: Telão, globo e câmera (puros)

**Files:** Create `scene3d/telao.ts`, `telao.test.ts`, `globe.ts`, `globe.test.ts`; Modify `scene3d/camera.ts`, `camera.test.ts`.

**Interfaces — Produces:**
- `TELAO_W = 1024`, `TELAO_H = 512`, `type TelaoView = { kind: 'lobby'; name: string; code: string } | { kind: 'game'; drawn: readonly number[] } | { kind: 'won'; nickname: string; isMe: boolean } | { kind: 'ended' }`, `type TelaoCtx = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'fillText' | 'beginPath' | 'arc' | 'fill'>`, `telaoView(i: { phase: 'lobby' | 'game'; name: string; code: string; drawn: readonly number[]; winner: { userId: string; nickname: string } | null; ended: boolean; myUserId: string | null }): TelaoView`, `drawTelao(ctx: TelaoCtx, view: TelaoView): void`, `LIT = '#fde047'`.
- `GLOBE_CENTER: Vec3`, `BALL_REST: Vec3`, `BALL_FLIGHT_MS = 1600`, `BALL_SHOW_MS = 3500`, `ballFlight(elapsedMs: number): { position: Vec3; scale: number; visible: boolean }`, `globeSpin(now: number, lastDrawAt: number): number` (rad/s), `innerBall(index: number, now: number): Vec3` (offset relativo ao centro, raio ≤ 0,55).
- `type CameraView = 'lobby' | 'game'`, `cameraFor(aspect: number, view?: CameraView): CameraSetup`, `focusOn(slot: Vec3): CameraSetup`, `approach(current: Vec3, target: Vec3, dtSeconds: number, rate?: number): Vec3`, `TELAO_CENTER: Vec3` e `TELAO_SIZE: [number, number]` (exportados de `telao.ts` para a câmera e o componente).

- [ ] **Step 1: Branch**

```bash
git switch main && git switch -c feat/front-m4-game-3d
```

- [ ] **Step 2: Testes que falham**

`src/features/game/scene3d/telao.test.ts`:

```ts
import { LIT, drawTelao, telaoView, type TelaoCtx, type TelaoView } from './telao';

type Call = { op: 'fillRect' | 'fillText' | 'arc'; args: unknown[]; fillStyle: string; font: string };

function fakeCtx() {
  const calls: Call[] = [];
  const ctx = {
    fillStyle: '#000',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args, fillStyle: String(ctx.fillStyle), font: ctx.font }),
    fillText: (...args: unknown[]) => calls.push({ op: 'fillText', args, fillStyle: String(ctx.fillStyle), font: ctx.font }),
    beginPath: () => undefined,
    arc: (...args: unknown[]) => calls.push({ op: 'arc', args, fillStyle: String(ctx.fillStyle), font: ctx.font }),
    fill: () => undefined,
  };
  return { ctx: ctx as unknown as TelaoCtx, calls, texts: () => calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])) };
}

const draw = (view: TelaoView) => {
  const f = fakeCtx();
  drawTelao(f.ctx, view);
  return f;
};

describe('drawTelao', () => {
  it('lobby: room name and code', () => {
    const f = draw({ kind: 'lobby', name: 'Amigos', code: 'ABC234' });
    expect(f.texts()).toEqual(expect.arrayContaining(['Amigos', 'ABC234']));
  });

  it('game: current ball with letter, the 4 previous, and exactly the drawn cells lit', () => {
    const drawn = [3, 18, 33, 48, 63, 70];
    const f = draw({ kind: 'game', drawn });
    const texts = f.texts();
    expect(texts).toEqual(expect.arrayContaining(['O', '70', 'O63', 'G48', 'N33', 'I18']));
    expect(texts).not.toContain('B3'); // só as 4 anteriores
    const litCells = f.calls.filter((c) => c.op === 'fillRect' && c.fillStyle === LIT);
    expect(litCells).toHaveLength(drawn.length);
    expect(f.calls.filter((c) => c.op === 'fillRect' && c.args[2] === 30)).toHaveLength(75); // 75 células
  });

  it('game without draws yet: waiting message, nothing lit', () => {
    const f = draw({ kind: 'game', drawn: [] });
    expect(f.texts()).toContain('Aguardando');
    expect(f.calls.filter((c) => c.op === 'fillRect' && c.fillStyle === LIT)).toHaveLength(0);
  });

  it('won: BINGO and the winner nickname, or "Você!" for me', () => {
    expect(draw({ kind: 'won', nickname: 'Ana', isMe: false }).texts()).toEqual(expect.arrayContaining(['BINGO!', 'Ana']));
    expect(draw({ kind: 'won', nickname: 'Ana', isMe: true }).texts()).toContain('Você!');
  });

  it('ended: end-of-game message', () => {
    expect(draw({ kind: 'ended' }).texts()).toContain('Fim de jogo');
  });
});

describe('telaoView', () => {
  const base = { phase: 'game' as const, name: 'Sala', code: 'ABC234', drawn: [1, 2], winner: null, ended: false, myUserId: 'me' };
  it('winner beats everything, using the nickname from the store', () =>
    expect(telaoView({ ...base, winner: { userId: 'x', nickname: 'Ana' }, ended: true })).toEqual({ kind: 'won', nickname: 'Ana', isMe: false }));
  it('flags my own win', () => expect(telaoView({ ...base, winner: { userId: 'me', nickname: 'Eu' } })).toMatchObject({ isMe: true }));
  it('ended without winner', () => expect(telaoView({ ...base, ended: true })).toEqual({ kind: 'ended' }));
  it('game shows the draws', () => expect(telaoView(base)).toEqual({ kind: 'game', drawn: [1, 2] }));
  it('lobby shows name and code', () => expect(telaoView({ ...base, phase: 'lobby' })).toEqual({ kind: 'lobby', name: 'Sala', code: 'ABC234' }));
});
```

`src/features/game/scene3d/globe.test.ts`:

```ts
import { BALL_FLIGHT_MS, BALL_REST, BALL_SHOW_MS, GLOBE_CENTER, ballFlight, globeSpin, innerBall } from './globe';

describe('ballFlight', () => {
  it('pops out of the globe, lands in front of the stage and disappears after the show time', () => {
    const start = ballFlight(0);
    start.position.forEach((v, i) => expect(v).toBeCloseTo(GLOBE_CENTER[i]));
    expect(start.scale).toBeLessThan(0.05);
    const landed = ballFlight(BALL_FLIGHT_MS * 0.7);
    landed.position.forEach((v, i) => expect(v).toBeCloseTo(BALL_REST[i], 1));
    expect(landed.scale).toBeCloseTo(1);
    expect(ballFlight(BALL_SHOW_MS).visible).toBe(false);
    expect(ballFlight(BALL_SHOW_MS - 1).visible).toBe(true);
  });

  it('finishes well within the 5 s draw interval (animation ≤ interval − 1 s)', () => {
    expect(BALL_SHOW_MS).toBeLessThanOrEqual(4000);
  });

  it('never returns NaN', () => {
    for (const t of [-10, 0, 100, 800, 1600, 3000, 99999]) {
      const f = ballFlight(t);
      [...f.position, f.scale].forEach((v) => expect(Number.isFinite(v)).toBe(true));
    }
  });
});

describe('globeSpin', () => {
  it('idles slowly and bursts right after a draw, decaying back', () => {
    const idle = globeSpin(10_000, 0);
    const burst = globeSpin(1_000, 1_000);
    const later = globeSpin(4_000, 1_000);
    expect(burst).toBeGreaterThan(idle * 5);
    expect(later).toBeLessThan(burst);
    expect(later).toBeCloseTo(idle, 1);
  });
});

describe('innerBall', () => {
  it('stays inside the cage', () => {
    for (let i = 0; i < 20; i++) for (const t of [0, 500, 7777]) expect(Math.hypot(...innerBall(i, t))).toBeLessThanOrEqual(0.55);
  });
});
```

Em `src/features/game/scene3d/camera.test.ts`, trocar o import e acrescentar ao final:

```ts
import { approach, cameraFor, focusOn, orbitPosition } from './camera';
import { BALL_REST, GLOBE_CENTER } from './globe';
import { TELAO_CENTER, TELAO_SIZE } from './telao';
```

```ts
describe('cameraFor(game)', () => {
  function projector(aspect: number) {
    const setup = cameraFor(aspect, 'game');
    const cam = new PerspectiveCamera(setup.fov, aspect, 0.1, 200);
    cam.position.set(...setup.position);
    cam.lookAt(...setup.target);
    cam.updateMatrixWorld();
    return (x: number, y: number, z: number) => new Vector3(x, y, z).project(cam);
  }

  it.each([0.5, 1.15, 2.2])('frames the whole screen, the globe and the ball at aspect %s', (aspect) => {
    const p = projector(aspect);
    const [cx, cy, cz] = TELAO_CENTER;
    const [w, h] = TELAO_SIZE;
    const points: [number, number, number][] = [
      [cx - w / 2, cy - h / 2, cz],
      [cx + w / 2, cy + h / 2, cz],
      [cx - w / 2, cy + h / 2, cz],
      [cx + w / 2, cy - h / 2, cz],
      [GLOBE_CENTER[0] + 0.8, GLOBE_CENTER[1], GLOBE_CENTER[2]],
      [GLOBE_CENTER[0], GLOBE_CENTER[1] - 0.8, GLOBE_CENTER[2]],
      [...BALL_REST],
    ];
    for (const point of points) {
      const v = p(...point);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe('focusOn', () => {
  it('centers the avatar in view', () => {
    const slot = [2.2, 0.4, 0.1] as const;
    const setup = focusOn(slot);
    const cam = new PerspectiveCamera(setup.fov, 1, 0.1, 200);
    cam.position.set(...setup.position);
    cam.lookAt(...setup.target);
    cam.updateMatrixWorld();
    const v = new Vector3(slot[0], slot[1] + 0.9, slot[2]).project(cam);
    expect(Math.abs(v.x)).toBeLessThan(0.05);
    expect(Math.abs(v.y)).toBeLessThan(0.05);
  });
});

describe('approach', () => {
  it('moves toward the target, converges and never overshoots', () => {
    let cur: readonly [number, number, number] = [0, 0, 0];
    const target = [10, -4, 2] as const;
    cur = approach(cur, target, 0.1);
    expect(cur[0]).toBeGreaterThan(0);
    expect(cur[0]).toBeLessThan(10);
    for (let i = 0; i < 200; i++) cur = approach(cur, target, 0.05);
    cur.forEach((v, i) => expect(v).toBeCloseTo(target[i], 3));
    expect(approach([0, 0, 0], target, 100)).toEqual([10, -4, 2]);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d`
Expected: FAIL (módulos `telao`/`globe` e exports novos da câmera não existem).

- [ ] **Step 4: Implementar**

`src/features/game/scene3d/telao.ts`:

```ts
import { letterFor } from '@/contracts';
import type { Vec3 } from './slots';

export const TELAO_W = 1024;
export const TELAO_H = 512;
/** Centro e tamanho (mundo) da tela do telão — usados pelo componente e pela câmera. */
export const TELAO_CENTER: Vec3 = [0, 3.3, -5.09];
export const TELAO_SIZE: [number, number] = [6.8, 3.4];
export const LIT = '#fde047';
const BG = '#111827';
const DIM = '#374151';

export type TelaoView =
  | { kind: 'lobby'; name: string; code: string }
  | { kind: 'game'; drawn: readonly number[] }
  | { kind: 'won'; nickname: string; isMe: boolean }
  | { kind: 'ended' };

export type TelaoCtx = Pick<CanvasRenderingContext2D, 'fillStyle' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'fillText' | 'beginPath' | 'arc' | 'fill'>;

export function telaoView(i: {
  phase: 'lobby' | 'game';
  name: string;
  code: string;
  drawn: readonly number[];
  winner: { userId: string; nickname: string } | null;
  ended: boolean;
  myUserId: string | null;
}): TelaoView {
  if (i.winner) return { kind: 'won', nickname: i.winner.nickname, isMe: i.winner.userId === i.myUserId };
  if (i.ended) return { kind: 'ended' };
  if (i.phase === 'game') return { kind: 'game', drawn: i.drawn };
  return { kind: 'lobby', name: i.name, code: i.code };
}

function text(ctx: TelaoCtx, value: string, x: number, y: number, font: string, color: string) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}

function ball(ctx: TelaoCtx, x: number, y: number, r: number) {
  ctx.fillStyle = LIT;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Desenha o telão numa canvas 2D (vira CanvasTexture). Pura em relação ao ctx: testável com um ctx falso. */
export function drawTelao(ctx: TelaoCtx, view: TelaoView): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, TELAO_W, TELAO_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  switch (view.kind) {
    case 'lobby':
      text(ctx, view.name, TELAO_W / 2, 130, 'bold 56px sans-serif', '#fef3c7');
      text(ctx, view.code, TELAO_W / 2, 300, 'bold 170px sans-serif', LIT);
      text(ctx, 'Código da sala', TELAO_W / 2, 440, '36px sans-serif', '#c4b5fd');
      return;
    case 'won':
      text(ctx, 'BINGO!', TELAO_W / 2, 210, 'bold 190px sans-serif', LIT);
      text(ctx, view.isMe ? 'Você!' : view.nickname, TELAO_W / 2, 400, 'bold 72px sans-serif', '#ffffff');
      return;
    case 'ended':
      text(ctx, 'Fim de jogo', TELAO_W / 2, 220, 'bold 110px sans-serif', '#fef3c7');
      text(ctx, 'Ninguém completou a cartela', TELAO_W / 2, 360, '44px sans-serif', '#c4b5fd');
      return;
    case 'game': {
      const drawn = view.drawn;
      const current = drawn.at(-1);
      if (current === undefined) {
        text(ctx, 'Aguardando', 200, 230, 'bold 44px sans-serif', '#c4b5fd');
      } else {
        ball(ctx, 200, 220, 150);
        text(ctx, letterFor(current), 200, 140, 'bold 64px sans-serif', BG);
        text(ctx, String(current), 200, 245, 'bold 150px sans-serif', BG);
      }
      drawn
        .slice(-5, -1)
        .reverse()
        .forEach((n, i) => {
          ball(ctx, 65 + i * 90, 445, 38);
          text(ctx, `${letterFor(n)}${n}`, 65 + i * 90, 447, 'bold 26px sans-serif', BG);
        });
      const lit = new Set(drawn);
      ['B', 'I', 'N', 'G', 'O'].forEach((letter, row) => text(ctx, letter, 440, 75 + row * 92, 'bold 40px sans-serif', LIT));
      for (let n = 1; n <= 75; n++) {
        const row = Math.floor((n - 1) / 15);
        const col = (n - 1) % 15;
        const x = 470 + col * 36;
        const y = 40 + row * 92;
        ctx.fillStyle = lit.has(n) ? LIT : DIM;
        ctx.fillRect(x, y, 30, 70);
        text(ctx, String(n), x + 15, y + 35, 'bold 18px sans-serif', lit.has(n) ? BG : '#9ca3af');
      }
      return;
    }
  }
}
```

`src/features/game/scene3d/globe.ts`:

```ts
import type { Vec3 } from './slots';

export const GLOBE_CENTER: Vec3 = [3.6, 1.6, -3.6];
/** Onde a bola sorteada para e flutua: à frente do palco, perto do globo. */
export const BALL_REST: Vec3 = [1.8, 2.0, -2.6];
export const BALL_FLIGHT_MS = 1600;
export const BALL_SHOW_MS = 3500;
const POP_END = 0.15;
const LAND = 0.7;
const IDLE_SPIN = 0.4;
const BURST_SPIN = 5;
const BURST_DECAY_MS = 600;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Trajetória cosmética da bola: sai do globo, arco até BALL_REST, flutua, encolhe e some. */
export function ballFlight(elapsedMs: number): { position: Vec3; scale: number; visible: boolean } {
  const t = Math.max(0, elapsedMs);
  const p = t / BALL_FLIGHT_MS;
  if (t >= BALL_SHOW_MS) return { position: BALL_REST, scale: 0, visible: false };
  if (p < POP_END) return { position: GLOBE_CENTER, scale: clamp01(p / POP_END), visible: true };
  if (p < LAND) {
    const k = ease((p - POP_END) / (LAND - POP_END));
    const arc = Math.sin(k * Math.PI) * 1.0;
    return {
      position: [
        GLOBE_CENTER[0] + (BALL_REST[0] - GLOBE_CENTER[0]) * k,
        GLOBE_CENTER[1] + (BALL_REST[1] - GLOBE_CENTER[1]) * k + arc,
        GLOBE_CENTER[2] + (BALL_REST[2] - GLOBE_CENTER[2]) * k,
      ],
      scale: 1,
      visible: true,
    };
  }
  const shrink = clamp01((BALL_SHOW_MS - t) / 300);
  return { position: [BALL_REST[0], BALL_REST[1] + 0.06 * Math.sin(t / 250), BALL_REST[2]], scale: shrink, visible: true };
}

/** Velocidade angular do globo (rad/s): giro lento + arranque logo após cada sorteio. */
export function globeSpin(now: number, lastDrawAt: number): number {
  if (lastDrawAt <= 0) return IDLE_SPIN;
  return IDLE_SPIN + BURST_SPIN * Math.exp(-Math.max(0, now - lastDrawAt) / BURST_DECAY_MS);
}

function rand(i: number, salt: number) {
  const x = Math.sin((i + 1) * 91.17 + salt * 13.73) * 43758.5453;
  return x - Math.floor(x);
}

/** Bolinhas chacoalhando dentro da gaiola (offset relativo ao centro do globo). */
export function innerBall(index: number, now: number): Vec3 {
  const r = 0.2 + rand(index, 1) * 0.3;
  const a = now / (300 + rand(index, 2) * 400) + rand(index, 3) * 6.28;
  const b = now / (500 + rand(index, 4) * 500) + rand(index, 5) * 6.28;
  return [r * Math.cos(a) * Math.sin(b), r * Math.cos(b) * 0.9, r * Math.sin(a) * Math.sin(b)];
}
```

`src/features/game/scene3d/camera.ts` — substituir o arquivo por:

```ts
import type { Vec3 } from './slots';

export type CameraSetup = { position: Vec3; target: Vec3; fov: number };
export type CameraView = 'lobby' | 'game';

const FOV = 45;
const MAX_DISTANCE = 26;
const VIEWS: Record<CameraView, { target: Vec3; halfWidth: number; halfHeight: number; elevation: number }> = {
  lobby: { target: [0, 1.1, -0.6], halfWidth: 5.6, halfHeight: 3.2, elevation: 0.32 },
  game: { target: [0.6, 2.6, -3.8], halfWidth: 4.9, halfHeight: 3.2, elevation: 0.12 },
};

/** Enquadramento por aspect: `lobby` = plateia + palco; `game` = telão + globo (plateia aparece embaixo quando cabe). */
export function cameraFor(aspect: number, view: CameraView = 'lobby'): CameraSetup {
  const v = VIEWS[view];
  const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
  const forWidth = v.halfWidth / (tanHalf * Math.max(aspect, 0.3));
  const forHeight = v.halfHeight / tanHalf;
  const distance = Math.min(Math.max(forWidth, forHeight), MAX_DISTANCE);
  return { fov: FOV, target: v.target, position: [v.target[0], v.target[1] + distance * v.elevation, v.target[2] + distance] };
}

/** Cena de vitória: câmera de frente para o avatar vencedor. */
export function focusOn(slot: Vec3): CameraSetup {
  const target: Vec3 = [slot[0], slot[1] + 0.9, slot[2]];
  return { fov: 40, target, position: [slot[0], slot[1] + 1.6, slot[2] + 4.2] };
}

/** Gira a câmera em torno do alvo (arrasto do lobby, ±15°). */
export function orbitPosition(setup: CameraSetup, yaw: number): Vec3 {
  const dx = setup.position[0] - setup.target[0];
  const dz = setup.position[2] - setup.target[2];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [setup.target[0] + dx * cos + dz * sin, setup.position[1], setup.target[2] - dx * sin + dz * cos];
}

/** Aproximação exponencial independente do FPS (sem ultrapassar o alvo). */
export function approach(current: Vec3, target: Vec3, dtSeconds: number, rate = 3): Vec3 {
  const k = 1 - Math.exp(-rate * Math.max(0, dtSeconds));
  return [current[0] + (target[0] - current[0]) * k, current[1] + (target[1] - current[1]) * k, current[2] + (target[2] - current[2]) * k];
}
```

Nota: `approach(..., dt=100)` dá `k = 1 − e^-300 = 1` em ponto flutuante, então o teste `toEqual([10,-4,2])` vale.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/features/game/scene3d`
Expected: PASS. Se o enquadramento `game` falhar num aspect, ajustar **só** `VIEWS.game` (alvo/halfWidth/halfHeight/elevation) até passar, sem quebrar os testes do lobby; registrar os valores no commit.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`

```bash
git add src/features/game/scene3d
git commit -m "feat(scene3d): screen texture painter, globe and ball flight, game camera and winner focus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: "Por 1" e vencedor no coreógrafo, na pose e no hook

**Files:** Modify `scene3d/pose.ts`, `pose.test.ts`, `choreographer.ts`, `choreographer.test.ts`, `use-avatar-states.ts`, `use-avatar-states.test.tsx`.

**Interfaces:**
- `Phase` ganha `'winner'`; `AvatarState` ganha `oneAway: boolean`; `Pose` ganha `glow: number` (0–1).
- `ChoreoInput` ganha `oneAway?: ReadonlySet<string>` e `winnerId?: string | null`.
- `labelIds` passa a incluir sempre quem está `oneAway` e o `winner`.
- `useAvatarStates` lê `snapshot.game.remaining` (=1) e `winner?.userId` da store.

- [ ] **Step 1: Testes que falham**

Em `pose.test.ts`: no helper `state(...)`, acrescentar `oneAway: false` ao objeto base; na lista do teste de NaN, acrescentar `p.glow`; e acrescentar:

```ts
  it('winner keeps jumping and spinning, fully glowing', () => {
    const ys = [100, 300, 500, 700].map((t) => pose(state('winner', 0), t).position[1]);
    expect(Math.max(...ys)).toBeGreaterThan(slot[1] + 0.2);
    expect(pose(state('winner', 0), 400).glow).toBe(1);
    expect(pose(state('winner', 0), 2000).rotationY).toBeGreaterThan(pose(state('winner', 0), 1000).rotationY);
  });

  it('one-away avatars glow and hop while idle; others do not', () => {
    const glows = [0, 100, 200, 300, 400].map((t) => pose(state('idle', 0, { oneAway: true }), t).glow);
    expect(Math.max(...glows)).toBeGreaterThan(0.5);
    glows.forEach((g) => expect(g).toBeLessThanOrEqual(1));
    expect(pose(state('idle', 0), 123).glow).toBe(0);
  });
```

(e incluir `'winner'` na lista `phases` do teste de NaN).

Em `choreographer.test.ts`, acrescentar:

```ts
describe('one away and winner', () => {
  it('flags who is one away', () => {
    const s = choreograph(null, { members: [m(A, 0), m(B, 1)], hostId: A, now: 0, oneAway: new Set([B]) });
    expect(s.get(B)?.oneAway).toBe(true);
    expect(s.get(A)?.oneAway).toBe(false);
  });

  it('the winner celebrates until the win is cleared', () => {
    const s0 = choreograph(null, { members: [m(A, 0), m(B, 1)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0), m(B, 1)], hostId: A, now: 50, winnerId: B });
    expect(s1.get(B)).toMatchObject({ phase: 'winner', phaseStart: 50 });
    const s2 = choreograph(s1, { members: [m(A, 0), m(B, 1)], hostId: A, now: 60, winnerId: B });
    expect(s2.get(B)?.phaseStart).toBe(50);
    const s3 = choreograph(s2, { members: [m(A, 0), m(B, 1)], hostId: A, now: 70, winnerId: null });
    expect(s3.get(B)?.phase).toBe('idle');
  });

  it('a winner who already left does not create an avatar', () => {
    const s = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0, winnerId: B });
    expect(s.has(B)).toBe(false);
  });

  it('statesChanged notices one-away changes', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    expect(statesChanged(s0, choreograph(s0, { members: [m(A, 0)], hostId: A, now: 1, oneAway: new Set([A]) }))).toBe(true);
  });

  it('labels always show who is one away and the winner', () => {
    const crowd = choreograph(null, { members: [m(A, 0), m(B, 1), m(C, 2)], hostId: A, now: 0, oneAway: new Set([C]) });
    expect(labelIds(crowd.values(), A, false)).toEqual(new Set([A, C]));
    const won = choreograph(crowd, { members: [m(A, 0), m(B, 1), m(C, 2)], hostId: A, now: 5, winnerId: B });
    expect(labelIds(won.values(), A, false).has(B)).toBe(true);
  });
});
```

Em `use-avatar-states.test.tsx`, acrescentar:

```tsx
  it('reads who is one away and who won from the store', () => {
    useGameStore.setState(
      reduce(initialGameState(ME), {
        event: 'room:state',
        payload: { ...room([member(ME, 0), member(ANA, 1)]), status: 'IN_GAME', game: { id: '00000000-0000-4000-8000-0000000000bb', drawn: [1], drawIntervalMs: 5000, remaining: { [ME]: 5, [ANA]: 1 } } },
      }),
    );
    const { result } = renderHook(() => useAvatarStates(0, clock));
    expect(result.current.statesRef.current.get(ANA)?.oneAway).toBe(true);
    act(() => useGameStore.getState().dispatch({ event: 'game:won', payload: { userId: ANA, nickname: 'Ana', pointsAwarded: 20 } }));
    expect(result.current.statesRef.current.get(ANA)?.phase).toBe('winner');
  });
```

(Se o tipo `Winner` do contrato tiver campos diferentes de `{ userId, nickname, pointsAwarded }`, usar os campos de `src/contracts` — conferir com `grep -n "winnerSchema" -A6 src/contracts/*.ts`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d`
Expected: FAIL (campos/fase novos não existem).

- [ ] **Step 3: Implementar**

`pose.ts`:
- `export type Phase = 'idle' | 'entering' | 'ready-jump' | 'ghost' | 'leaving' | 'dance' | 'winner';`
- em `AvatarState`, acrescentar `/** Falta 1 pedra (destaque dourado). */ oneAway: boolean;`
- em `Pose`, acrescentar `/** 0–1: brilho dourado ("por 1" / vencedor). */ glow: number;`
- **todo** objeto `Pose` retornado ganha `glow: 0`, exceto:
  - `idlePose`: `glow: s.oneAway ? 0.5 + 0.5 * Math.sin(now / 250) : 0` e, quando `s.oneAway`, `position: [slot[0], slot[1] + Math.abs(Math.sin(now / 300)) * 0.12, slot[2]]`;
  - novo `case 'winner'`:

```ts
    case 'winner':
      return {
        position: [slot[0], slot[1] + Math.abs(Math.sin(dt / 250)) * 0.5, slot[2]],
        rotationY: dt / 400,
        headYaw: 0,
        scale: 1,
        armRaise: 1,
        armSwing: 0.8 * Math.sin(dt / 90),
        glow: 1,
        ghost: 0,
      };
```

`choreographer.ts`:
- `ChoreoInput`: acrescentar `oneAway?: ReadonlySet<string>; winnerId?: string | null;` e desestruturar com padrões `oneAway = EMPTY, winnerId = null` (`const EMPTY: ReadonlySet<string> = new Set();`).
- no ramo de membro existente, depois das regras de ghost/ready, acrescentar:

```ts
      if (member.userId === winnerId) {
        if (phase !== 'winner') [phase, phaseStart] = ['winner', now];
      } else if (phase === 'winner') {
        [phase, phaseStart] = [member.connected ? 'idle' : 'ghost', now];
      }
```

- no objeto montado, acrescentar `oneAway: oneAway.has(member.userId),`.
- `statesChanged`: acrescentar `|| o.oneAway !== s.oneAway` na condição.
- `labelIds`: condição passa a `showAll || s.userId === myUserId || s.isHost || s.phase === 'entering' || s.phase === 'winner' || s.oneAway`.

Nota: `PHASE_MS`/`TEMPORARY_PHASES` não mudam — `winner` não expira sozinho (sai quando `winnerId` some, no `room:state` do "jogar de novo").

`use-avatar-states.ts` — dentro de `recompute`, trocar a leitura da store e a chamada:

```ts
      const { snapshot, winner } = useGameStore.getState();
      if (!snapshot) return;
      const bots = botMembers(botsShown.current, snapshot.members.map((m) => m.slot));
      const members = [...snapshot.members, ...bots];
      const oneAway = new Set(Object.entries(snapshot.game?.remaining ?? {}).filter(([, left]) => left === 1).map(([id]) => id));
      commit(choreograph(initialized.current ? statesRef.current : null, { members, hostId: snapshot.hostId, now: clock(), oneAway, winnerId: winner?.userId ?? null }));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game`
Expected: PASS (incluindo os testes antigos do M3).

- [ ] **Step 5: Commit**

```bash
git add src/features/game/scene3d
git commit -m "feat(scene3d): one-away glow and winner celebration in the choreographer and poses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sons sintetizados e mudo

**Files:** Create `src/features/game/sound/sfx.ts`, `sfx.test.ts`, `sfx-player.ts`, `sfx-player.test.ts`, `use-muted.ts`, `use-muted.test.tsx`, `use-game-sounds.ts`, `use-game-sounds.test.tsx`.

**Interfaces — Produces:**
- `type Sfx = 'draw' | 'one-away' | 'bingo-me' | 'bingo-other' | 'ended'`, `interface Note { freq: number; at: number; dur: number; wave: OscillatorType; gain: number }`, `SFX_NOTES: Record<Sfx, Note[]>`, `interface SoundState { drawnCount: number; oneAway: ReadonlySet<string>; winnerId: string | null; ended: boolean }`, `sfxFor(prev: SoundState | null, next: SoundState, myUserId: string | null): Sfx[]`.
- `type AudioCtxLike = Pick<AudioContext, 'currentTime' | 'state' | 'resume' | 'createOscillator' | 'createGain' | 'destination'>`, `interface SfxPlayer { unlock(): void; play(sfx: Sfx): void }`, `createSfxPlayer(factory: () => AudioCtxLike | null): SfxPlayer`, `sharedSfxPlayer(): SfxPlayer`.
- `useMuted(): [boolean, (muted: boolean) => void]` (chave `go-bingo:muted`).
- `useGameSounds(muted: boolean, player?: SfxPlayer): void`.

- [ ] **Step 1: Testes que falham**

`src/features/game/sound/sfx.test.ts`:

```ts
import { SFX_NOTES, sfxFor, type SoundState } from './sfx';

const s = (over: Partial<SoundState> = {}): SoundState => ({ drawnCount: 0, oneAway: new Set(), winnerId: null, ended: false, ...over });

describe('sfxFor', () => {
  it('first snapshot is silent (join / reload mid-game)', () => {
    expect(sfxFor(null, s({ drawnCount: 40, oneAway: new Set(['a']), winnerId: 'a', ended: true }), 'me')).toEqual([]);
  });
  it('a new number plays the draw sound once', () => {
    expect(sfxFor(s({ drawnCount: 3 }), s({ drawnCount: 4 }), 'me')).toEqual(['draw']);
  });
  it('nothing when the count did not grow (duplicate event, replay reset)', () => {
    expect(sfxFor(s({ drawnCount: 4 }), s({ drawnCount: 4 }), 'me')).toEqual([]);
    expect(sfxFor(s({ drawnCount: 40 }), s({ drawnCount: 0 }), 'me')).toEqual([]);
  });
  it('someone newly one away', () => {
    expect(sfxFor(s({ oneAway: new Set(['a']) }), s({ oneAway: new Set(['a', 'b']) }), 'me')).toEqual(['one-away']);
    expect(sfxFor(s({ oneAway: new Set(['a']) }), s({ oneAway: new Set(['a']) }), 'me')).toEqual([]);
  });
  it('fanfare for my win, chord for someone else', () => {
    expect(sfxFor(s(), s({ winnerId: 'me' }), 'me')).toEqual(['bingo-me']);
    expect(sfxFor(s(), s({ winnerId: 'ana' }), 'me')).toEqual(['bingo-other']);
  });
  it('game ended without winner', () => {
    expect(sfxFor(s(), s({ ended: true }), 'me')).toEqual(['ended']);
  });
  it('every sound has audible, finite notes', () => {
    for (const notes of Object.values(SFX_NOTES)) {
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.freq).toBeGreaterThan(50);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.3);
      }
    }
  });
});
```

`src/features/game/sound/sfx-player.test.ts`:

```ts
import { createSfxPlayer, type AudioCtxLike } from './sfx-player';
import { SFX_NOTES } from './sfx';

function fakeAudio(state: AudioContextState = 'running') {
  const oscillators: { type: string; freq: number[]; started: number; stopped: number }[] = [];
  const param = () => ({ setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  const ctx = {
    currentTime: 10,
    state,
    resume: vi.fn(async () => undefined),
    destination: {},
    createGain: () => ({ gain: param(), connect: vi.fn() }),
    createOscillator: () => {
      const o = { type: 'sine', freq: [] as number[], started: 0, stopped: 0 };
      oscillators.push(o);
      return {
        set type(v: string) {
          o.type = v;
        },
        frequency: { setValueAtTime: (f: number) => o.freq.push(f) },
        connect: vi.fn(),
        start: (t: number) => (o.started = t),
        stop: (t: number) => (o.stopped = t),
      };
    },
  };
  return { ctx: ctx as unknown as AudioCtxLike, oscillators, resume: ctx.resume };
}

describe('createSfxPlayer', () => {
  it('schedules one oscillator per note, starting now', () => {
    const audio = fakeAudio();
    const player = createSfxPlayer(() => audio.ctx);
    player.play('draw');
    expect(audio.oscillators).toHaveLength(SFX_NOTES.draw.length);
    expect(audio.oscillators[0].freq[0]).toBe(SFX_NOTES.draw[0].freq);
    expect(audio.oscillators[0].started).toBeCloseTo(10 + SFX_NOTES.draw[0].at);
    expect(audio.oscillators[0].stopped).toBeGreaterThan(audio.oscillators[0].started);
  });

  it('creates the AudioContext lazily, once, and resumes a suspended one', () => {
    const audio = fakeAudio('suspended');
    const factory = vi.fn(() => audio.ctx);
    const player = createSfxPlayer(factory);
    expect(factory).not.toHaveBeenCalled();
    player.unlock();
    player.play('draw');
    expect(factory).toHaveBeenCalledTimes(1);
    expect(audio.resume).toHaveBeenCalled();
  });

  it('is a silent no-op without WebAudio', () => {
    const player = createSfxPlayer(() => null);
    expect(() => {
      player.unlock();
      player.play('bingo-me');
    }).not.toThrow();
  });
});
```

`src/features/game/sound/use-muted.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { useMuted } from './use-muted';

describe('useMuted', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to sound on and persists the choice', () => {
    const { result } = renderHook(() => useMuted());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(renderHook(() => useMuted()).result.current[0]).toBe(true);
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useMuted());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
```

`src/features/game/sound/use-game-sounds.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import type { RoomSnapshot } from '@/contracts';
import { initialGameState, reduce, useGameStore } from '../store';
import { useGameSounds } from './use-game-sounds';

const ME = '00000000-0000-4000-8000-000000000001';
const ANA = '00000000-0000-4000-8000-000000000002';
const member = (userId: string, slot: number) => ({ userId, nickname: userId === ME ? 'Eu' : 'Ana', slot, isGuest: false, connected: true, hasCard: true });
const inGame = (drawn: number[], remaining: Record<string, number> = { [ME]: 10, [ANA]: 10 }): RoomSnapshot => ({
  code: 'ABC234', name: 'Sala', hostId: ME, maxPlayers: 10, isPublic: true, status: 'IN_GAME',
  members: [member(ME, 0), member(ANA, 1)], myCard: null,
  game: { id: '00000000-0000-4000-8000-0000000000bb', drawn, drawIntervalMs: 5000, remaining },
});

describe('useGameSounds', () => {
  const player = { unlock: vi.fn(), play: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    useGameStore.setState(reduce(initialGameState(ME), { event: 'room:state', payload: inGame([1, 2, 3]) }));
  });

  it('is silent on the first snapshot, then plays each new number', () => {
    renderHook(() => useGameSounds(false, player));
    expect(player.play).not.toHaveBeenCalled();
    act(() => useGameStore.getState().dispatch({ event: 'game:number_drawn', payload: { number: 40 } as never }));
    expect(player.play).toHaveBeenCalledWith('draw');
  });

  it('plays the one-away chime and my fanfare', () => {
    renderHook(() => useGameSounds(false, player));
    act(() => useGameStore.getState().dispatch({ event: 'game:progress', payload: { remaining: { [ME]: 1, [ANA]: 10 } } as never }));
    expect(player.play).toHaveBeenCalledWith('one-away');
    act(() => useGameStore.getState().dispatch({ event: 'game:won', payload: { userId: ME, nickname: 'Eu', pointsAwarded: 20 } as never }));
    expect(player.play).toHaveBeenCalledWith('bingo-me');
  });

  it('stays quiet when muted', () => {
    renderHook(() => useGameSounds(true, player));
    act(() => useGameStore.getState().dispatch({ event: 'game:number_drawn', payload: { number: 40 } as never }));
    expect(player.play).not.toHaveBeenCalled();
  });

  it('unlocks audio on the first tap', () => {
    renderHook(() => useGameSounds(false, player));
    window.dispatchEvent(new Event('pointerdown'));
    expect(player.unlock).toHaveBeenCalledTimes(1);
  });
});
```

(Os `as never` contornam campos extras dos payloads de evento do contrato; se `game:number_drawn` exigir mais campos, preencher conforme `src/contracts/events.ts` e remover o cast.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/sound`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`src/features/game/sound/sfx.ts`:

```ts
export type Sfx = 'draw' | 'one-away' | 'bingo-me' | 'bingo-other' | 'ended';

export interface Note {
  freq: number;
  /** segundos a partir do início do efeito */
  at: number;
  dur: number;
  wave: OscillatorType;
  gain: number;
}

const arpeggio = (freqs: number[], step: number, dur: number, wave: OscillatorType, gain: number): Note[] => freqs.map((freq, i) => ({ freq, at: i * step, dur, wave, gain }));

export const SFX_NOTES: Record<Sfx, Note[]> = {
  draw: [
    { freq: 660, at: 0, dur: 0.08, wave: 'triangle', gain: 0.22 },
    { freq: 990, at: 0.07, dur: 0.14, wave: 'triangle', gain: 0.18 },
  ],
  'one-away': arpeggio([880, 1175, 1568], 0.11, 0.14, 'sine', 0.16),
  'bingo-me': [...arpeggio([523, 659, 784, 1047], 0.12, 0.22, 'square', 0.1), { freq: 1047, at: 0.5, dur: 0.7, wave: 'triangle', gain: 0.18 }],
  'bingo-other': arpeggio([784, 988, 1175], 0.14, 0.3, 'sine', 0.14),
  ended: arpeggio([392, 330, 262], 0.25, 0.35, 'sine', 0.14),
};

export interface SoundState {
  drawnCount: number;
  oneAway: ReadonlySet<string>;
  winnerId: string | null;
  ended: boolean;
}

/** Que sons tocar entre dois estados. Primeiro estado (entrar/recarregar) é sempre silencioso. */
export function sfxFor(prev: SoundState | null, next: SoundState, myUserId: string | null): Sfx[] {
  if (!prev) return [];
  const out: Sfx[] = [];
  if (next.drawnCount > prev.drawnCount) out.push('draw');
  if ([...next.oneAway].some((id) => !prev.oneAway.has(id))) out.push('one-away');
  if (next.winnerId && next.winnerId !== prev.winnerId) out.push(next.winnerId === myUserId ? 'bingo-me' : 'bingo-other');
  if (next.ended && !prev.ended) out.push('ended');
  return out;
}
```

`src/features/game/sound/sfx-player.ts`:

```ts
import { SFX_NOTES, type Sfx } from './sfx';

export type AudioCtxLike = Pick<AudioContext, 'currentTime' | 'state' | 'resume' | 'createOscillator' | 'createGain' | 'destination'>;

export interface SfxPlayer {
  unlock(): void;
  play(sfx: Sfx): void;
}

/** Sons sintetizados (sem arquivos): um oscilador com envelope por nota. AudioContext criado só no primeiro uso. */
export function createSfxPlayer(factory: () => AudioCtxLike | null): SfxPlayer {
  let ctx: AudioCtxLike | null = null;
  let tried = false;
  const ensure = () => {
    if (!tried) {
      tried = true;
      ctx = factory();
    }
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  };
  return {
    unlock: () => void ensure(),
    play(sfx) {
      const c = ensure();
      if (!c) return;
      const t0 = c.currentTime;
      for (const n of SFX_NOTES[sfx]) {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const start = t0 + n.at;
        osc.type = n.wave;
        osc.frequency.setValueAtTime(n.freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(n.gain, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(start);
        osc.stop(start + n.dur + 0.02);
      }
    },
  };
}

function browserAudio(): AudioCtxLike | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    return new AC();
  } catch {
    return null;
  }
}

let shared: SfxPlayer | null = null;
export function sharedSfxPlayer(): SfxPlayer {
  shared ??= createSfxPlayer(browserAudio);
  return shared;
}
```

`src/features/game/sound/use-muted.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';

const KEY = 'go-bingo:muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function useMuted(): [boolean, (muted: boolean) => void] {
  const [muted, setState] = useState(readMuted);
  const setMuted = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // Armazenamento bloqueado: vale só nesta sessão.
    }
    setState(next);
  }, []);
  return [muted, setMuted];
}
```

`src/features/game/sound/use-game-sounds.ts`:

```ts
'use client';

import { useEffect } from 'react';
import { useGameStore, type GameStoreState } from '../store';
import { sfxFor, type SoundState } from './sfx';
import { sharedSfxPlayer, type SfxPlayer } from './sfx-player';

function toSoundState(s: GameStoreState): SoundState {
  const remaining = s.snapshot?.game?.remaining ?? {};
  return {
    drawnCount: s.snapshot?.game?.drawn.length ?? 0,
    oneAway: new Set(Object.entries(remaining).filter(([, left]) => left === 1).map(([id]) => id)),
    winnerId: s.winner?.userId ?? null,
    ended: s.endedWithoutWinner,
  };
}

/** Toca os efeitos da partida a partir da store (2D e 3D). Mudo = nada toca; primeiro estado é silencioso. */
export function useGameSounds(muted: boolean, player: SfxPlayer = sharedSfxPlayer()) {
  useEffect(() => {
    const unlock = () => player.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [player]);

  useEffect(() => {
    let prev: SoundState | null = null;
    const check = () => {
      const state = useGameStore.getState();
      if (!state.snapshot) {
        prev = null;
        return;
      }
      const next = toSoundState(state);
      const effects = sfxFor(prev, next, state.myUserId);
      prev = next;
      if (!muted) effects.forEach((sfx) => player.play(sfx));
    };
    check();
    return useGameStore.subscribe(check);
  }, [muted, player]);
}
```

Nota: `useGameSounds(muted, player = sharedSfxPlayer())` chama `sharedSfxPlayer()` em todo render, mas é memoizado no módulo (mesma instância) — o efeito não re-roda por isso. `sharedSfxPlayer` não cria AudioContext até `unlock`/`play`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game/sound`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
git add src/features/game/sound
git commit -m "feat(sound): synthesized draw, one-away and bingo sounds with persistent mute

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cena da partida (R3F) e Canvas comum

**Files:** Create `scene3d/stage-canvas.tsx`, `telao.tsx`, `globe.tsx`, `game-stage.tsx`, `game-stage-lazy.tsx`; Modify `scene3d/lobby-stage.tsx`, `hall.tsx`, `camera-rig.tsx`, `avatar-crowd.tsx`.

**Interfaces:**
- `StageCanvas({ qualityOverride, onContextLost, children: (settings: TierSettings, tier: Tier) => ReactNode })` — Canvas + qualidade + `PerformanceMonitor` + `ContextLossWatcher` + fundo/neblina (tudo que hoje está no `LobbyStage`).
- `Telao({ view: TelaoView })`, `Globe({ lastNumber: number | null; drawCount: number; innerBalls: number })`.
- `Hall({ screen: TelaoView; animatedBulbs; shadows })` (sem `roomName`/`code`; sem globo).
- `CameraRig({ view?: CameraView; focus?: Vec3 | null })`.
- `GameStage(props: { roomName: string; code: string; qualityOverride: QualityOverride; onContextLost: () => void })` (default export) e `GameStageLazy`.

- [ ] **Step 1: `StageCanvas` (extrair do lobby)**

`src/features/game/scene3d/stage-canvas.tsx`:

```tsx
'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { contextLossGuard } from './context-loss';
import { TIER_SETTINGS, initialQuality, pickInitialTier, stepDown, stepUp, type QualityOverride, type QualityState, type Tier, type TierSettings } from './quality';

function startQuality(override: QualityOverride): QualityState {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const tier = override === 'auto' ? pickInitialTier({ cores: nav.hardwareConcurrency || 4, memoryGb: nav.deviceMemory ?? null, screenWidth: window.innerWidth }) : override;
  return initialQuality(tier, window.devicePixelRatio || 1);
}

/**
 * Escuta perda de contexto real. O cleanup roda quando a cena desmonta, antes de o R3F descartar o renderer
 * (que força uma perda de propósito) — essa não pode contar como falha do aparelho.
 */
function ContextLossWatcher({ onLost }: { onLost: () => void }) {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const guard = contextLossGuard(onLost);
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', guard.handle);
    return () => {
      guard.dispose();
      canvas.removeEventListener('webglcontextlost', guard.handle);
    };
  }, [gl, onLost]);
  return null;
}

function usePageHidden() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

/** Canvas comum do lobby e da partida: qualidade adaptativa, DPR, pausa em segundo plano, perda de contexto. */
export function StageCanvas({
  qualityOverride,
  onContextLost,
  children,
}: {
  qualityOverride: QualityOverride;
  onContextLost: () => void;
  children: (settings: TierSettings, tier: Tier) => ReactNode;
}) {
  const [quality, setQuality] = useState<QualityState>(() => startQuality(qualityOverride));
  const [appliedOverride, setAppliedOverride] = useState(qualityOverride);
  if (appliedOverride !== qualityOverride) {
    setAppliedOverride(qualityOverride);
    setQuality(startQuality(qualityOverride));
  }
  const inclined = useRef(false);
  const hidden = usePageHidden();
  const settings = TIER_SETTINGS[quality.tier];

  return (
    <Canvas
      aria-hidden="true"
      role="presentation"
      dpr={quality.dpr}
      frameloop={hidden ? 'never' : 'always'}
      shadows={settings.shadows === 'real'}
      gl={{ antialias: settings.antialias, powerPreference: 'high-performance' }}
      camera={{ fov: 45, near: 0.1, far: 100, position: [0, 9, 20] }}
      style={{ touchAction: 'pan-y' }}
    >
      <ContextLossWatcher onLost={onContextLost} />
      {qualityOverride === 'auto' && (
        <PerformanceMonitor
          flipflops={3}
          onDecline={() => setQuality(stepDown)}
          onIncline={() => {
            if (inclined.current) return;
            inclined.current = true;
            setQuality(stepUp);
          }}
        />
      )}
      <color attach="background" args={['#2e1065']} />
      <fog attach="fog" args={['#2e1065', 18, 40]} />
      {children(settings, quality.tier)}
    </Canvas>
  );
}
```

`src/features/game/scene3d/lobby-stage.tsx` — substituir por:

```tsx
'use client';

import { useState } from 'react';
import { AvatarCrowd } from './avatar-crowd';
import { parseBots } from './bots';
import { CameraRig } from './camera-rig';
import { Confetti } from './confetti';
import { Globe } from './globe-mesh';
import { Hall } from './hall';
import { NameLabels } from './name-labels';
import type { QualityOverride } from './quality';
import { StageCanvas } from './stage-canvas';
import { useAvatarStates } from './use-avatar-states';

export interface LobbyStageProps {
  roomName: string;
  code: string;
  /** Partida começou: confete antes de trocar para a tela do jogo. */
  celebrating: boolean;
  qualityOverride: QualityOverride;
  onContextLost: () => void;
}

export const BOTS_ENABLED = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_BOTS === '1';

/** Palco 3D do lobby. Carregado só via `next/dynamic` (ssr:false). */
export default function LobbyStage({ roomName, code, celebrating, qualityOverride, onContextLost }: LobbyStageProps) {
  const [bots] = useState(() => parseBots(window.location.search, BOTS_ENABLED));
  const { statesRef, list, dance } = useAvatarStates(bots);

  return (
    <StageCanvas qualityOverride={qualityOverride} onContextLost={onContextLost}>
      {(settings, tier) => (
        <>
          <CameraRig view="lobby" />
          <Hall screen={{ kind: 'lobby', name: roomName, code }} animatedBulbs={settings.animatedBulbs} shadows={settings.shadows === 'real'} />
          <Globe lastNumber={null} drawCount={0} innerBalls={tier === 'low' ? 8 : 18} />
          <AvatarCrowd statesRef={statesRef} onTap={dance} castShadow={settings.shadows === 'real'} fakeShadow={settings.shadows === 'fake'} />
          <NameLabels list={list} statesRef={statesRef} showAll={tier === 'high' || list.length <= 15} />
          {celebrating && settings.confetti > 0 && <Confetti count={settings.confetti} />}
        </>
      )}
    </StageCanvas>
  );
}
```

Nota de nome: o componente do globo fica em `globe-mesh.tsx` (não `globe.tsx`) para não colidir com o módulo puro `globe.ts` no import `./globe`.

- [ ] **Step 2: Telão, globo e salão**

`src/features/game/scene3d/telao.tsx`:

```tsx
'use client';

import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { TELAO_CENTER, TELAO_H, TELAO_SIZE, TELAO_W, drawTelao, type TelaoView } from './telao';

/** Telão como uma única textura de canvas 2D: bola atual, 4 anteriores e painel 1–75 (1 draw call). */
export function Telao({ view }: { view: TelaoView }) {
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = TELAO_W;
    c.height = TELAO_H;
    return c;
  }, []);
  const texture = useMemo(() => {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [canvas]);

  useEffect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawTelao(ctx, view);
    texture.needsUpdate = true;
  }, [canvas, texture, view]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh position={TELAO_CENTER}>
      <planeGeometry args={TELAO_SIZE} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
```

Nota: `telao.tsx` e `telao.ts` têm o mesmo nome-base. Para evitar ambiguidade de resolução (`./telao` → `.ts`), nomear o componente `telao-screen.tsx` e importar o puro como `./telao`.

`src/features/game/scene3d/globe-mesh.tsx`:

```tsx
'use client';

import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Object3D, type Group, type InstancedMesh, type Mesh } from 'three';
import { letterFor } from '@/contracts';
import { GLOBE_CENTER, ballFlight, globeSpin, innerBall } from './globe';

/** Globo-gaiola girando com bolinhas dentro; a cada sorteio acelera e solta a bola com letra e número. */
export function Globe({ lastNumber, drawCount, innerBalls }: { lastNumber: number | null; drawCount: number; innerBalls: number }) {
  const cage = useRef<Mesh>(null);
  const inner = useRef<InstancedMesh>(null);
  const ball = useRef<Group>(null);
  const angle = useRef(0);
  const lastDrawAt = useRef(0);
  const seenCount = useRef<number | null>(null);
  const o = useMemo(() => new Object3D(), []);

  // Só anima quando o número de sorteios AUMENTA com a cena montada (reconexão/recarga não anima).
  useEffect(() => {
    if (seenCount.current !== null && drawCount > seenCount.current) lastDrawAt.current = performance.now();
    seenCount.current = drawCount;
  }, [drawCount]);

  useFrame((_, delta) => {
    const now = performance.now();
    angle.current += globeSpin(now, lastDrawAt.current) * delta;
    cage.current?.rotation.set(angle.current * 0.6, angle.current, 0);
    const mesh = inner.current;
    if (mesh) {
      for (let i = 0; i < innerBalls; i++) {
        const p = innerBall(i, now * (lastDrawAt.current > 0 && now - lastDrawAt.current < 800 ? 3 : 1));
        o.position.set(GLOBE_CENTER[0] + p[0], GLOBE_CENTER[1] + p[1], GLOBE_CENTER[2] + p[2]);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    const group = ball.current;
    if (group) {
      const flight = lastDrawAt.current > 0 ? ballFlight(now - lastDrawAt.current) : null;
      group.visible = Boolean(flight?.visible && lastNumber !== null);
      if (flight && group.visible) {
        group.position.set(...flight.position);
        group.scale.setScalar(Math.max(flight.scale, 0.0001));
      }
    }
  });

  return (
    <group>
      <mesh ref={cage} position={GLOBE_CENTER}>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.6} wireframe />
      </mesh>
      <instancedMesh ref={inner} args={[undefined, undefined, innerBalls]} frustumCulled={false}>
        <sphereGeometry args={[0.11, 8, 6]} />
        <meshStandardMaterial color="#fef3c7" />
      </instancedMesh>
      <mesh position={[GLOBE_CENTER[0], 0.45, GLOBE_CENTER[2]]}>
        <cylinderGeometry args={[0.3, 0.5, 0.6, 8]} />
        <meshStandardMaterial color="#be185d" flatShading />
      </mesh>
      <group ref={ball} visible={false}>
        <mesh>
          <sphereGeometry args={[0.34, 16, 12]} />
          <meshStandardMaterial color="#fde047" roughness={0.3} />
        </mesh>
        {lastNumber !== null && (
          <Billboard>
            <Text position={[0, 0, 0.35]} fontSize={0.17} lineHeight={1} color="#111827" anchorX="center" anchorY="middle" textAlign="center">
              {`${letterFor(lastNumber)}\n${lastNumber}`}
            </Text>
          </Billboard>
        )}
      </group>
    </group>
  );
}
```

`hall.tsx` — mudanças:
- props passam a `{ screen, animatedBulbs, shadows }: { screen: TelaoView; animatedBulbs: boolean; shadows: boolean }`;
- remover o mesh do globo, o `ref` `globe` e a linha de `emissiveIntensity` no `useFrame`;
- remover os dois `<Text>` do telão e o import de `Text`;
- o mesh da moldura do telão vira `<mesh position={[0, 3.3, -5.2]}><boxGeometry args={[7.2, 3.8, 0.2]} />…` e logo depois `<TelaoScreen view={screen} />` (import de `./telao-screen`; tipo `TelaoView` de `./telao`).

`camera-rig.tsx` — substituir o `useFrame` e a assinatura:

```tsx
export function CameraRig({ view = 'lobby', focus = null }: { view?: CameraView; focus?: Vec3 | null }) {
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const targetYaw = useRef(0);
  const pos = useRef<Vec3 | null>(null);
  const look = useRef<Vec3 | null>(null);
  // (useEffect do arrasto inalterado)
  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera;
    yaw.current += (targetYaw.current - yaw.current) * Math.min(1, delta * 8);
    const setup = focus ? focusOn(focus) : cameraFor(state.size.width / Math.max(1, state.size.height), view);
    const desired = focus ? setup.position : orbitPosition(setup, yaw.current);
    pos.current = pos.current ? approach(pos.current, desired, delta, 2.5) : desired;
    look.current = look.current ? approach(look.current, setup.target, delta, 2.5) : setup.target;
    if (Math.abs(camera.fov - setup.fov) > 0.01) {
      camera.fov += (setup.fov - camera.fov) * Math.min(1, delta * 2.5);
      camera.updateProjectionMatrix();
    }
    camera.position.set(...pos.current);
    camera.lookAt(...look.current);
  });
  return null;
}
```

(imports: `approach, cameraFor, focusOn, orbitPosition, type CameraView` de `./camera`; `type Vec3` de `./slots`).

`avatar-crowd.tsx` — na cor do corpo, aplicar o brilho dourado:

```ts
      tmp.color.set(s.look.body).lerp(GHOST, ps.ghost).lerp(GOLD, ps.glow * 0.6);
```

- [ ] **Step 3: Cena da partida e lazy**

`src/features/game/scene3d/game-stage.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useGameStore } from '../store';
import { AvatarCrowd } from './avatar-crowd';
import { parseBots } from './bots';
import { CameraRig } from './camera-rig';
import { Confetti } from './confetti';
import { Globe } from './globe-mesh';
import { Hall } from './hall';
import { BOTS_ENABLED } from './lobby-stage';
import { NameLabels } from './name-labels';
import type { QualityOverride } from './quality';
import { slotPosition } from './slots';
import { StageCanvas } from './stage-canvas';
import { telaoView } from './telao';
import { useAvatarStates } from './use-avatar-states';

export interface GameStageProps {
  roomName: string;
  code: string;
  qualityOverride: QualityOverride;
  onContextLost: () => void;
}

const NO_DRAWS: readonly number[] = [];

/** Palco 3D da partida: telão, globo, plateia com "por 1" e cena de vitória. */
export default function GameStage({ roomName, code, qualityOverride, onContextLost }: GameStageProps) {
  const [bots] = useState(() => parseBots(window.location.search, BOTS_ENABLED));
  const { statesRef, list, dance } = useAvatarStates(bots);
  const drawn = useGameStore((s) => s.snapshot?.game?.drawn ?? NO_DRAWS);
  const winner = useGameStore((s) => s.winner);
  const ended = useGameStore((s) => s.endedWithoutWinner);
  const myUserId = useGameStore((s) => s.myUserId);

  const screen = useMemo(
    () => telaoView({ phase: 'game', name: roomName, code, drawn, winner: winner && { userId: winner.userId, nickname: winner.nickname }, ended, myUserId }),
    [roomName, code, drawn, winner, ended, myUserId],
  );
  const winnerState = winner ? list.find((s) => s.userId === winner.userId) : undefined;
  const focus = winnerState ? slotPosition(winnerState.slot) : null;

  return (
    <StageCanvas qualityOverride={qualityOverride} onContextLost={onContextLost}>
      {(settings, tier) => (
        <>
          <CameraRig view="game" focus={focus} />
          <Hall screen={screen} animatedBulbs={settings.animatedBulbs} shadows={settings.shadows === 'real'} />
          <Globe lastNumber={drawn.at(-1) ?? null} drawCount={drawn.length} innerBalls={tier === 'low' ? 8 : 18} />
          <AvatarCrowd statesRef={statesRef} onTap={dance} castShadow={settings.shadows === 'real'} fakeShadow={settings.shadows === 'fake'} />
          <NameLabels list={list} statesRef={statesRef} showAll={tier === 'high' || list.length <= 15} />
          {winner && settings.confetti > 0 && <Confetti count={settings.confetti} />}
        </>
      )}
    </StageCanvas>
  );
}
```

`src/features/game/scene3d/game-stage-lazy.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';

/** RNF-3D-01: three.js só é baixado dentro da sala. */
export const GameStageLazy = dynamic(() => import('./game-stage'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-violet-950 to-fuchsia-900 text-sm text-violet-100" aria-hidden="true">
      Ligando o telão…
    </div>
  ),
});
```

- [ ] **Step 4: Verificar**

Run: `npm run lint && npm run typecheck && npx vitest run && npm run build && npm run check:bundle`
Expected: tudo verde. (Componentes R3F sem teste unitário; o `check:bundle` garante que three continua fora de `/`, `/criar`, `/ranking`.)

- [ ] **Step 5: Commit**

```bash
git add src/features/game/scene3d
git commit -m "feat(scene3d): game stage with spinning globe, live screen texture, one-away glow and winner camera

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: HUD — painel, som, palco da partida e atraso do resultado

**Files:** Create `drawn-board.tsx`, `drawn-board.test.tsx`, `sound-toggle.tsx`, `sound-toggle.test.tsx`; Modify `game-view.tsx`, `game-view.test.tsx`, `room-screen.tsx`, `room-screen.test.tsx`.

**Interfaces:**
- `DrawnBoard({ drawn }: { drawn: readonly number[] })` — botão "Painel" que abre diálogo com 75 números (`data-drawn`).
- `SoundToggle({ muted, onChange })` — botão com `aria-pressed={muted}` e rótulo "Desligar som"/"Ligar som".
- `GameView({ actions, stage?, muted, onToggleMute })`.
- `RESULT_DELAY_MS = 2500` (em `room-screen.tsx`).

- [ ] **Step 1: Testes que falham**

`src/features/game/drawn-board.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DrawnBoard } from './drawn-board';

describe('DrawnBoard', () => {
  it('opens the 1–75 board with the drawn numbers lit', async () => {
    render(<DrawnBoard drawn={[1, 16, 75]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Painel' }));
    const cells = screen.getAllByRole('listitem');
    expect(cells).toHaveLength(75);
    expect(cells.filter((c) => c.dataset.drawn === 'true').map((c) => c.textContent)).toEqual(['1', '16', '75']);
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('O')).toBeInTheDocument();
  });
});
```

`src/features/game/sound-toggle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SoundToggle } from './sound-toggle';

describe('SoundToggle', () => {
  it('mutes and unmutes', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SoundToggle muted={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Desligar som' }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<SoundToggle muted onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Ligar som' })).toHaveAttribute('aria-pressed', 'true');
  });
});
```

Em `game-view.test.tsx`: todos os `render(<GameView actions={actions} />)` passam a `render(<GameView actions={actions} muted={false} onToggleMute={vi.fn()} />)`; e acrescentar:

```tsx
  it('puts the 3D stage in the stage area but keeps the number announced for screen readers', () => {
    load([]);
    render(<GameView actions={actions} muted={false} onToggleMute={vi.fn()} stage={<div data-testid="stage" />} />);
    expect(screen.getByTestId('stage')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('25'); // LastNumbers continua (sr-only)
  });

  it('offers the board and the sound toggle in both modes', () => {
    load([]);
    render(<GameView actions={actions} muted onToggleMute={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Painel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ligar som' })).toBeInTheDocument();
  });
```

(`load([])` no arquivo existente sorteia `grid.filter(n => n !== 0)`, então o último sorteado é 25.)

Em `room-screen.test.tsx`, acrescentar ao lado dos outros mocks:

```tsx
vi.mock('./scene3d/game-stage-lazy', () => ({ GameStageLazy: () => <div data-testid="game-stage" /> }));
vi.mock('./sound/use-game-sounds', () => ({ useGameSounds: vi.fn() }));
```

e os testes:

```tsx
  it('3D mode: the game screen gets the 3D stage', () => {
    sceneMode.value = { ...SCENE_2D, mode: '3d', reason: 'ok' };
    renderWith(room({ status: 'IN_GAME', myCard: { id: '00000000-0000-4000-8000-0000000000aa', grid, marked: [] }, game: { id: '00000000-0000-4000-8000-0000000000bb', drawn: [], drawIntervalMs: 5000, remaining: { [ME]: 24 } } }));
    expect(screen.getByTestId('game-stage')).toBeInTheDocument();
  });

  it('3D mode: the result dialog waits for the victory scene', () => {
    vi.useFakeTimers();
    try {
      sceneMode.value = { ...SCENE_2D, mode: '3d', reason: 'ok' };
      renderWith(room({ status: 'IN_GAME', myCard: { id: '00000000-0000-4000-8000-0000000000aa', grid, marked: [] }, game: { id: '00000000-0000-4000-8000-0000000000bb', drawn: [], drawIntervalMs: 5000, remaining: { [ME]: 24 } } }));
      act(() => useGameStore.getState().dispatch({ event: 'game:won', payload: { userId: ANA, nickname: 'Ana', pointsAwarded: 20 } as never }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.getByRole('dialog')).toHaveTextContent('Ana fez BINGO!');
    } finally {
      vi.useRealTimers();
    }
  });
```

(O teste existente `shows the result dialog after a win and replays` roda em 2D — mock padrão — e continua exigindo o diálogo imediato.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game`
Expected: FAIL (componentes novos e props novas não existem).

- [ ] **Step 3: Implementar**

`src/features/game/drawn-board.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

/** Painel 1–75 na HUD (telas pequenas e leitores de tela; no 3D ele também está no telão). */
export function DrawnBoard({ drawn }: { drawn: readonly number[] }) {
  const lit = new Set(drawn);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="h-9">
          Painel
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Números sorteados ({drawn.length}/75)</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {LETTERS.map((letter, row) => (
            <div key={letter} className="flex items-center gap-1.5">
              <span className="text-primary w-5 text-center font-black">{letter}</span>
              <ol className="grid flex-1 grid-cols-[repeat(15,minmax(0,1fr))] gap-0.5" aria-label={`Coluna ${letter}`}>
                {Array.from({ length: 15 }, (_, i) => row * 15 + i + 1).map((n) => (
                  <li
                    key={n}
                    data-drawn={lit.has(n)}
                    className={cn('rounded py-0.5 text-center text-[10px] font-bold tabular-nums', lit.has(n) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}
                  >
                    {n}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`src/features/game/sound-toggle.tsx`:

```tsx
'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SoundToggle({ muted, onChange }: { muted: boolean; onChange: (muted: boolean) => void }) {
  return (
    <Button variant="secondary" size="icon" className="size-9" aria-pressed={muted} aria-label={muted ? 'Ligar som' : 'Desligar som'} onClick={() => onChange(!muted)}>
      {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
    </Button>
  );
}
```

`game-view.tsx` — assinatura e região do palco:

```tsx
export function GameView({ actions, stage, muted, onToggleMute }: { actions: GameActions; stage?: ReactNode; muted: boolean; onToggleMute: (muted: boolean) => void }) {
```

e a `<section data-stage …>` passa a:

```tsx
      <section data-stage className="relative flex items-center justify-center overflow-hidden p-2 landscape:row-span-2">
        {stage ? (
          <>
            <div className="absolute inset-0">{stage}</div>
            <div className="sr-only">
              <LastNumbers drawn={drawn} />
            </div>
          </>
        ) : (
          <LastNumbers drawn={drawn} />
        )}
        <div className="absolute top-2 right-2 flex gap-2">
          <DrawnBoard drawn={drawn} />
          <SoundToggle muted={muted} onChange={onToggleMute} />
        </div>
      </section>
```

(imports: `type ReactNode` de `react`, `DrawnBoard`, `SoundToggle`). Quando `stage` existe, remover o padding da seção (`p-2` só no 2D): usar `className={cn('relative flex items-center justify-center overflow-hidden landscape:row-span-2', !stage && 'p-2')}`.

`room-screen.tsx`:
- imports: `GameStageLazy` de `./scene3d/game-stage-lazy`, `useGameSounds` de `./sound/use-game-sounds`, `useMuted` de `./sound/use-muted`;
- `export const RESULT_DELAY_MS = 2500;` no topo do módulo;
- depois de `const showGame = …`:

```tsx
  const resultReady = useCelebrationDelay(snapshot ? showResult : null, scene.mode === '3d', RESULT_DELAY_MS);
  const [muted, setMuted] = useMuted();
  useGameSounds(muted);
```

- trocar `<GameView actions={actions} />` por:

```tsx
        <GameView
          actions={actions}
          muted={muted}
          onToggleMute={setMuted}
          stage={
            scene.mode === '3d' ? (
              <StageErrorBoundary onError={scene.reportFailure}>
                <GameStageLazy key={scene.stageKey} roomName={snapshot.name} code={snapshot.code} qualityOverride={scene.quality} onContextLost={scene.reportContextLoss} />
              </StageErrorBoundary>
            ) : undefined
          }
        />
```

- trocar `{showResult && <ResultDialog …/>}` por `{showResult && resultReady && <ResultDialog …/>}`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, cobertura, build, bundle, commit**

Run: `npm run lint && npm run typecheck && npm run test:cov && npm run build && npm run check:bundle`

```bash
git add src/features/game
git commit -m "feat(game): 3D game stage in the HUD, 1-75 board, sound toggle and delayed result for the victory scene

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentação e roadmap

**Files:** Modify `README.md`, `docs/superpowers/plans/2026-10-05-roadmap.md` (front e back, idênticos); copiar este plano e o spec para o back.

- [ ] **Step 1: README** — acrescentar depois da seção "Lobby 3D (M3)" (antes de `# workspace-agents`):

````markdown
### Partida 3D (M4)

- Telão desenhado numa textura de canvas 2D (`scene3d/telao.ts`): bola atual, 4 anteriores, painel 1–75.
- Globo gira, acelera e solta a bola a cada sorteio (cosmético; a HUD mostra o número na hora).
- "Por 1": boneco dourado pulsando; vitória: câmera vai até o vencedor, telão "BINGO!", confete; diálogo de resultado após 2,5 s no 3D.
- Sons sintetizados (WebAudio, sem arquivos) com botão de mudo persistente; "Painel" mostra o 1–75 na HUD nos dois modos.

**Checklist de aparelho real (critério de saída do M4):**

- [ ] Partida com `?bots=25` no Android intermediário: ≥ 30 FPS no tier automático.
- [ ] A cada sorteio: número aparece na HUD na hora; globo acelera; bola voa e some antes do próximo sorteio; telão atualiza.
- [ ] Alguém fica "por 1": boneco dourado + toast + som.
- [ ] Vitória vista de dois aparelhos: câmera no vencedor, telão "BINGO! — Nome" ("Você!" no do vencedor), confete, diálogo depois.
- [ ] Recarregar no meio da partida: sem som e sem bola voando; telão com o estado certo.
- [ ] Mudo persiste após recarregar; modo 2D joga a partida inteira com "Painel" e som.
````

- [ ] **Step 2: Roadmap** — linha 5 (M4) nos dois repos: Plano `[2026-10-07-front-m4-game-3d.md](2026-10-07-front-m4-game-3d.md)`, Repos `front (sem mudança no back)`, Status `Implementado na branch \`feat/front-m4-game-3d\` (falta checklist em aparelho real — README do front)`; linha 4 (M3) Status → `Concluído (merge no main; falta checklist em aparelho real)`. Copiar este plano e `docs/superpowers/specs/2026-10-07-m4-game-3d-design.md` para o back.

- [ ] **Step 3: Verificação final e commits**

Run: `npm run lint && npm run typecheck && npm run test:cov && npm run build && npm run check:bundle`

```bash
git add README.md docs
git commit -m "docs: M4 game 3D notes, device checklist and roadmap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd ../go-bingo-back && git add docs && git commit -m "docs(plan): M4 game 3D plan, spec and roadmap status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && cd ../go-bingo-front
```

---

## Self-Review

- **Spec:** G1 → Task 4 (`StageCanvas`, `GameStage`); G2 → Tasks 1 (`drawTelao`) e 4 (`TelaoScreen`, lobby também usa); G3 → Tasks 1 (`BALL_SHOW_MS ≤ 4000`), 4 (bola só anima com aumento), 5 (`LastNumbers` sr-only); G4 → Task 2; G5 → Tasks 1 e 4; G6 → Task 3; G7 → Task 5; G8 → Task 5.
- **Nomes de arquivo:** puro `globe.ts`/`telao.ts` vs componentes `globe-mesh.tsx`/`telao-screen.tsx` — sem colisão de `./globe`/`./telao`. `BOTS_ENABLED` exportado de `lobby-stage.tsx` e reusado em `game-stage.tsx`.
- **Tipos:** `Pose.glow` adicionado em todos os retornos; `AvatarState.oneAway` adicionado no coreógrafo e no helper de testes de `pose`; `ChoreoInput.oneAway/winnerId` opcionais (testes do M3 seguem válidos); `GameView` ganha `muted/onToggleMute` obrigatórios — todos os renders de `GameView` (teste e `RoomScreen`) atualizados.
- **Review Focus → testes:** 1 → `sfxFor first snapshot`, `useGameSounds silent on first snapshot`, Globe `seenCount`; 2 → `sfxFor` sem aumento; 3 → `useGameSounds muted`, `useMuted blocked`; 4 → `telaoView winner`, `winner who left`; 5 → `GameView … both modes`, teste 2D existente do resultado.
