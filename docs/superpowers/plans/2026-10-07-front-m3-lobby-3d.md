# Go Bingo Front — M3 (Lobby 3D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na sala de espera, mostrar cada jogador como um boneco 3D procedural num salão de game show (entra andando, pula ao ficar pronto, vira fantasma ao cair, acena ao sair, dança ao toque), com qualidade adaptativa, fallback 2D e three.js carregado só dentro da sala.

**Architecture:** Lógica 100% em módulos puros testáveis (`avatar-look`, `slots`, `camera`, `pose`, `choreographer`, `ambience`, `display-mode`, `quality`, `bots`) sob `src/features/game/scene3d/`. Um hook (`useAvatarStates`) assina a store Zustand existente fora do ciclo de render, roda o coreógrafo e guarda o estado num ref; componentes R3F leem o ref no `useFrame`, calculam `pose()` e escrevem direto nas matrizes de `InstancedMesh` (1 mesh por peça do boneco). A `RoomScreen` decide 3D/2D (`useSceneMode`), carrega o palco com `next/dynamic` (`ssr:false`) acima da `LobbyView` existente e atrasa a troca para a partida em 1,2 s para o confete.

**Tech Stack:** Next.js 16, React 19.2, three 0.186, @react-three/fiber 9.8, @react-three/drei 10.7, Zustand 5, Vitest + Testing Library.

**Spec:** [docs/superpowers/specs/2026-10-07-m3-lobby-3d-design.md](../specs/2026-10-07-m3-lobby-3d-design.md) · PRD: [docs/PRD.md](../../PRD.md) (E2, US-3.3, §4.2, §4.3, RNF-3D-01..08) · Roadmap: [2026-10-05-roadmap.md](2026-10-05-roadmap.md)

## Global Constraints

- Só o repo `go-bingo-front`. **Nenhuma** mudança no back nem em `src/contracts/` (gerado).
- Arte procedural (primitivas do three); nenhum arquivo `.glb/.gltf`/textura novo.
- Estado por frame **nunca** vai para a store Zustand nem para `useState`; vive em refs e matrizes.
- `pose()` é função pura de `(state, nowMs)`; tempos em **milissegundos** (`performance.now()` no app, números fixos nos testes).
- three/R3F/drei só podem ser importados dentro de `src/features/game/scene3d/` e apenas por módulos carregados via `next/dynamic` — nunca pela Home, login, ranking, criar. `scene3d/*.ts` puros **não** importam three, exceto `camera.test.ts` (teste).
- Canvas `aria-hidden`; toda informação essencial continua na HUD DOM (`LobbyView`, inalterada).
- Apelidos no 3D só via `<Text>` do drei (texto puro), nunca HTML.
- Modo 2D = a tela atual do lobby, sem canvas. Toda funcionalidade de jogo funciona nele.
- Textos de interface em pt-BR.
- Cobertura ≥ 80% (Princípio VIII). Exclusão adicionada **só** para `src/features/game/scene3d/**/*.tsx` (componentes R3F de renderização, sem regra). Toda regra fica em `.ts` coberto.
- Ao editar arquivos existentes, preservar o final de linha original do arquivo (LF/CRLF) — não reescrever arquivos inteiros com ferramentas que convertam.
- Comandos em Git Bash no Windows, a partir de `E:/projetos/go-bingo/go-bingo-front`, na branch `feat/front-m3-lobby-3d` criada de `main`.
- Trailer de commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Evento repetido/fora de ordem após reconexão** (mesmo `room:state` duas vezes, `member_joined` de quem já está) → nenhum avatar reinicia animação nem "entra de novo". Testes em Task 3 (`does not restart`, `reconnection goes idle without entering`).
2. **Entrar numa sala já cheia** (primeiro snapshot com 25 pessoas) → todos aparecem parados no lugar, sem desfile de 25 entradas. Teste em Task 3 (`first snapshot`).
3. **Aparelho sem WebGL2 / reduced-motion / contexto perdido 2×** → sala abre em 2D com a HUD completa e aviso na perda de contexto; o usuário que escolheu "3D" explicitamente com reduced-motion recebe 3D. Testes em Tasks 4 e 8.
4. **Toque no avatar de outra pessoa** → nada acontece (só o meu dança). Teste em Task 3/5 (`triggerDance` / `dance(other)`).
5. **`localStorage` bloqueado (aba anônima do Safari)** → preferências caem no padrão, sem exceção. Teste em Task 4 (`scene-prefs`).

---

## File Structure

```
src/features/game/
  scene3d/                          (tudo que é 3D; .tsx excluídos da cobertura)
    avatar-look.ts · .test.ts       Task 1  avatarFromId, hashId, BODY_COLORS...
    slots.ts · .test.ts             Task 1  slotPosition, DOOR, MAX_SLOTS
    camera.ts · .test.ts            Task 1  cameraFor(aspect), orbitPosition
    pose.ts · .test.ts              Task 2  types AvatarState/Phase/Pose, PHASE_MS, pose()
    choreographer.ts · .test.ts     Task 3  choreograph, triggerDance, statesChanged, labelIds
    ambience.ts · .test.ts          Task 3  bulbLevel, confettiParticle
    display-mode.ts · .test.ts      Task 4  pickDisplayMode
    quality.ts · .test.ts           Task 4  Tier, TIER_SETTINGS, pickInitialTier, initialDpr, stepDown, stepUp
    scene-prefs.ts · .test.ts       Task 4  read/write preferências
    bots.ts · .test.ts              Task 4  parseBots, botMembers, botName
    use-avatar-states.ts · .test.tsx Task 5 hook store → coreógrafo
    lobby-stage.tsx                 Task 6  Canvas + composição (default export)
    hall.tsx                        Task 6  salão, palco, telão, globo, porta, lâmpadas
    camera-rig.tsx                  Task 6  enquadramento + arrasto
    avatar-crowd.tsx                Task 7  InstancedMesh por peça + picking
    name-labels.tsx                 Task 7  rótulos billboard
    confetti.tsx                    Task 7  confete
    lobby-stage-lazy.tsx            Task 8  next/dynamic + esqueleto
  use-scene-mode.ts · .test.tsx     Task 8  decide 3D/2D, qualidade, perdas de contexto
  use-celebration-delay.ts · .test.tsx Task 8
  scene-controls.tsx · .test.tsx    Task 8  toggle 3D/2D + seletor de qualidade
  room-screen.tsx · .test.tsx       Task 8  MODIFY
scripts/check-bundle.mjs            Task 9
.github/workflows/ci.yml            Task 9  MODIFY
vitest.config.mts                   Task 6  MODIFY (exclusão *.tsx do scene3d)
README.md · docs/.../roadmap.md     Task 9  MODIFY (roadmap também no back)
```

---

### Task 1: Dependências 3D, aparência do avatar, slots e câmera (puros)

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/features/game/scene3d/avatar-look.ts`, `avatar-look.test.ts`, `slots.ts`, `slots.test.ts`, `camera.ts`, `camera.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = readonly [number, number, number]` (em `slots.ts`)
  - `hashId(id: string): number`, `avatarFromId(id: string): AvatarLook`, `type AvatarLook = { body: string; accent: string; hat: Hat; face: Face; seed: number }`, `type Hat = 'none'|'tophat'|'cap'|'beanie'|'party'`, `type Face = 'smile'|'grin'|'wow'`, `BODY_COLORS`, `ACCENT_COLORS`, `HATS`, `FACES`
  - `MAX_SLOTS = 25`, `DOOR: Vec3`, `slotPosition(slot: number): Vec3`
  - `type CameraSetup = { position: Vec3; target: Vec3; fov: number }`, `cameraFor(aspect: number): CameraSetup`, `orbitPosition(setup: CameraSetup, yaw: number): Vec3`

- [ ] **Step 1: Branch e dependências**

```bash
git switch main && git switch -c feat/front-m3-lobby-3d
npm install three@^0.186.1 @react-three/fiber@^9.8.1 @react-three/drei@^10.7.9
npm install -D @types/three@^0.186.0
```
Expected: instala sem conflito de peer (React 19.2 está dentro de `>=19 <19.4`).

- [ ] **Step 2: Testes que falham**

`src/features/game/scene3d/avatar-look.test.ts`:

```ts
import { ACCENT_COLORS, BODY_COLORS, FACES, HATS, avatarFromId, hashId } from './avatar-look';

const ids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`);

describe('avatarFromId', () => {
  it('is deterministic', () => {
    expect(avatarFromId(ids[7])).toEqual(avatarFromId(ids[7]));
    expect(hashId('abc')).toBe(hashId('abc'));
  });

  it('only produces values from the palettes, with a seed in [0, 1)', () => {
    for (const id of ids) {
      const look = avatarFromId(id);
      expect(BODY_COLORS).toContain(look.body);
      expect(ACCENT_COLORS).toContain(look.accent);
      expect(HATS).toContain(look.hat);
      expect(FACES).toContain(look.face);
      expect(look.seed).toBeGreaterThanOrEqual(0);
      expect(look.seed).toBeLessThan(1);
    }
  });

  it('spreads looks across a room-sized crowd', () => {
    const looks = ids.map(avatarFromId);
    expect(new Set(looks.map((l) => l.body)).size).toBe(BODY_COLORS.length);
    expect(new Set(looks.map((l) => l.hat)).size).toBe(HATS.length);
    expect(new Set(looks.map((l) => l.face)).size).toBe(FACES.length);
  });
});
```

`src/features/game/scene3d/slots.test.ts`:

```ts
import { DOOR, MAX_SLOTS, slotPosition } from './slots';

const all = Array.from({ length: MAX_SLOTS }, (_, i) => slotPosition(i));
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe('slotPosition', () => {
  it('gives 25 distinct places at least 0.9 apart on the floor plane', () => {
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(dist(all[i], all[j])).toBeGreaterThanOrEqual(0.9);
  });

  it('fills the front row first, centered (host in the middle)', () => {
    expect(slotPosition(0)[0]).toBeCloseTo(0);
    expect(slotPosition(0)[2]).toBeGreaterThan(slotPosition(9)[2]);
    expect(Math.abs(slotPosition(1)[0])).toBeLessThan(Math.abs(slotPosition(8)[0]));
  });

  it('raises back rows like bleachers', () => {
    expect(slotPosition(24)[1]).toBeGreaterThan(slotPosition(0)[1]);
  });

  it('wraps out-of-range slots instead of returning undefined', () => {
    expect(slotPosition(25)).toEqual(slotPosition(0));
    expect(slotPosition(-1)).toEqual(slotPosition(24));
  });

  it('keeps the door outside the crowd, to the left', () => {
    expect(DOOR[0]).toBeLessThan(Math.min(...all.map((p) => p[0])) - 1);
  });
});
```

`src/features/game/scene3d/camera.test.ts` (usa three só no teste, para projetar):

```ts
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraFor, orbitPosition } from './camera';
import { MAX_SLOTS, slotPosition } from './slots';

function project(aspect: number, yaw = 0) {
  const setup = cameraFor(aspect);
  const cam = new PerspectiveCamera(setup.fov, aspect, 0.1, 200);
  cam.position.set(...orbitPosition(setup, yaw));
  cam.lookAt(...setup.target);
  cam.updateMatrixWorld();
  return (p: readonly [number, number, number], dy = 0) => new Vector3(p[0], p[1] + dy, p[2]).project(cam);
}

describe('cameraFor', () => {
  it.each([0.5, 1.15, 2.2])('frames every avatar (feet and head) at aspect %s', (aspect) => {
    const toNdc = project(aspect);
    for (let s = 0; s < MAX_SLOTS; s++) {
      for (const dy of [0, 1.3]) {
        const v = toNdc(slotPosition(s), dy);
        expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the crowd framed while dragged to the yaw limit', () => {
    const toNdc = project(1.15, 0.26);
    for (let s = 0; s < MAX_SLOTS; s++) expect(Math.abs(toNdc(slotPosition(s)).x)).toBeLessThanOrEqual(1);
  });

  it('orbitPosition with yaw 0 is the base position', () => {
    const setup = cameraFor(1);
    orbitPosition(setup, 0).forEach((v, i) => expect(v).toBeCloseTo(setup.position[i]));
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar**

`src/features/game/scene3d/avatar-look.ts`:

```ts
export const BODY_COLORS = ['#f43f5e', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'] as const;
export const ACCENT_COLORS = ['#fde047', '#ffffff', '#1e293b', '#34d399', '#fb7185', '#60a5fa'] as const;
export const HATS = ['none', 'tophat', 'cap', 'beanie', 'party'] as const;
export const FACES = ['smile', 'grin', 'wow'] as const;

export type Hat = (typeof HATS)[number];
export type Face = (typeof FACES)[number];
export type AvatarLook = { body: string; accent: string; hat: Hat; face: Face; seed: number };

/** FNV-1a 32 bits: rápido, estável entre navegadores. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Boneco P0 (PRD E2): derivado do id, igual em qualquer aparelho, nada guardado no back. */
export function avatarFromId(id: string): AvatarLook {
  const h = hashId(id);
  return {
    body: BODY_COLORS[h % BODY_COLORS.length],
    accent: ACCENT_COLORS[(h >>> 3) % ACCENT_COLORS.length],
    hat: HATS[(h >>> 6) % HATS.length],
    face: FACES[(h >>> 9) % FACES.length],
    seed: (h >>> 12) / 2 ** 20,
  };
}
```

`src/features/game/scene3d/slots.ts`:

```ts
export type Vec3 = readonly [number, number, number];

export const MAX_SLOTS = 25;
const SPACING = 1.1;
/** Plateia de frente para a câmera; o palco/telão fica atrás (z negativo). Fileiras de trás mais altas. */
const ROWS = [
  { count: 9, z: 1.6, y: 0 },
  { count: 8, z: 0.2, y: 0.4 },
  { count: 8, z: -1.2, y: 0.8 },
] as const;

export const DOOR: Vec3 = [-6.5, 0, 1.6];

function rowXs(count: number): number[] {
  const xs = Array.from({ length: count }, (_, k) => (k - (count - 1) / 2) * SPACING);
  // Do centro para fora, alternando direita/esquerda: o slot 0 (host) fica no meio da frente.
  return xs.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
}

const SLOT_POSITIONS: Vec3[] = ROWS.flatMap((row) => rowXs(row.count).map((x): Vec3 => [x, row.y, row.z - 0.05 * x * x]));

export function slotPosition(slot: number): Vec3 {
  const index = ((Math.floor(slot) % MAX_SLOTS) + MAX_SLOTS) % MAX_SLOTS;
  return SLOT_POSITIONS[index];
}
```

`src/features/game/scene3d/camera.ts`:

```ts
import type { Vec3 } from './slots';

export type CameraSetup = { position: Vec3; target: Vec3; fov: number };

const TARGET: Vec3 = [0, 1.1, -0.6];
const FOV = 45;
const HALF_WIDTH = 5.6;
const HALF_HEIGHT = 3.2;
const MAX_DISTANCE = 26;

/** Enquadra plateia + palco para qualquer aspect (retrato da região do canvas, paisagem, desktop). */
export function cameraFor(aspect: number): CameraSetup {
  const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
  const forWidth = HALF_WIDTH / (tanHalf * Math.max(aspect, 0.3));
  const forHeight = HALF_HEIGHT / tanHalf;
  const distance = Math.min(Math.max(forWidth, forHeight), MAX_DISTANCE);
  return { fov: FOV, target: TARGET, position: [TARGET[0], TARGET[1] + distance * 0.32, TARGET[2] + distance] };
}

/** Gira a câmera em torno do alvo (arrasto do lobby, ±15°). */
export function orbitPosition(setup: CameraSetup, yaw: number): Vec3 {
  const dx = setup.position[0] - setup.target[0];
  const dz = setup.position[2] - setup.target[2];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [setup.target[0] + dx * cos + dz * sin, setup.position[1], setup.target[2] - dx * sin + dz * cos];
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/features/game/scene3d`
Expected: PASS. Se o teste de enquadramento falhar num aspect, ajustar **só** `HALF_WIDTH`/`HALF_HEIGHT`/`MAX_DISTANCE`/`TARGET` em `camera.ts` (constantes de composição) até passar, e registrar o valor final no commit.

- [ ] **Step 6: Lint, typecheck e commit**

Run: `npm run lint && npm run typecheck`
Expected: verde.

```bash
git add package.json package-lock.json src/features/game/scene3d
git commit -m "feat(scene3d): 3D deps, deterministic avatar look, bleacher slots and camera framing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Poses — fases e animações como funções puras do tempo

**Files:**
- Create: `src/features/game/scene3d/pose.ts`, `src/features/game/scene3d/pose.test.ts`

**Interfaces:**
- Consumes: `AvatarLook`, `avatarFromId` (Task 1); `Vec3`, `DOOR`, `slotPosition` (Task 1).
- Produces:
  - `type Phase = 'idle' | 'entering' | 'ready-jump' | 'ghost' | 'leaving' | 'dance'`
  - `interface AvatarState { userId: string; slot: number; look: AvatarLook; phase: Phase; phaseStart: number; isHost: boolean; connected: boolean; hasCard: boolean; lookAtDoorUntil: number }`
  - `PHASE_MS: { entering: 1800; 'ready-jump': 600; leaving: 2200; dance: 1500 }`, `TEMPORARY_PHASES: readonly Phase[]`
  - `interface Pose { position: Vec3; rotationY: number; headYaw: number; scale: number; armRaise: number; armSwing: number; ghost: number }`
  - `pose(state: AvatarState, now: number): Pose`

- [ ] **Step 1: Teste que falha**

`src/features/game/scene3d/pose.test.ts`:

```ts
import { avatarFromId } from './avatar-look';
import { PHASE_MS, pose, type AvatarState, type Phase } from './pose';
import { DOOR, slotPosition } from './slots';

const ID = '00000000-0000-4000-8000-000000000001';
function state(phase: Phase, phaseStart = 0, overrides: Partial<AvatarState> = {}): AvatarState {
  return { userId: ID, slot: 3, look: avatarFromId(ID), phase, phaseStart, isHost: false, connected: phase !== 'ghost', hasCard: false, lookAtDoorUntil: 0, ...overrides };
}
const slot = slotPosition(3);

describe('pose', () => {
  it('entering starts at the door and ends exactly on the slot, facing the camera', () => {
    const start = pose(state('entering', 1000), 1000);
    expect(start.position[0]).toBeCloseTo(DOOR[0]);
    expect(start.position[2]).toBeCloseTo(DOOR[2]);
    const end = pose(state('entering', 1000), 1000 + PHASE_MS.entering);
    end.position.forEach((v, i) => expect(v).toBeCloseTo(slot[i]));
    expect(end.rotationY).toBeCloseTo(0);
  });

  it('entering faces the direction of travel midway', () => {
    const mid = pose(state('entering', 0), PHASE_MS.entering / 2);
    expect(mid.rotationY).toBeGreaterThan(0.3); // porta à esquerda → anda para +x
  });

  it('ready-jump peaks around 0.6 above the slot at half time and lands', () => {
    expect(pose(state('ready-jump', 0), PHASE_MS['ready-jump'] / 2).position[1]).toBeCloseTo(slot[1] + 0.6, 1);
    expect(pose(state('ready-jump', 0), PHASE_MS['ready-jump']).position[1]).toBeCloseTo(slot[1]);
  });

  it('idle stays on the slot and breathes subtly', () => {
    for (const t of [0, 333, 1234, 9999]) {
      const p = pose(state('idle'), t);
      expect(p.position[0]).toBeCloseTo(slot[0]);
      expect(p.position[2]).toBeCloseTo(slot[2]);
      expect(Math.abs(p.scale - 1)).toBeLessThanOrEqual(0.021);
    }
  });

  it('idle turns the head toward the door while someone is arriving', () => {
    const p = pose(state('idle', 0, { lookAtDoorUntil: 500 }), 100);
    expect(p.headYaw).toBeLessThan(-0.3); // porta à esquerda
    expect(Math.abs(pose(state('idle', 0, { lookAtDoorUntil: 500 }), 600).headYaw)).toBeLessThanOrEqual(0.16);
  });

  it('ghost is pale and floats above the slot', () => {
    const p = pose(state('ghost'), 777);
    expect(p.ghost).toBe(1);
    expect(p.position[1]).toBeGreaterThan(slot[1]);
  });

  it('leaving waves first, then walks to the door and shrinks away', () => {
    const waving = pose(state('leaving', 0), 300);
    expect(waving.armRaise).toBe(1);
    waving.position.forEach((v, i) => i !== 1 && expect(v).toBeCloseTo(slot[i]));
    const end = pose(state('leaving', 0), PHASE_MS.leaving);
    expect(end.position[0]).toBeCloseTo(DOOR[0]);
    expect(end.scale).toBeCloseTo(0);
  });

  it('dance spins two full turns', () => {
    expect(pose(state('dance', 0), PHASE_MS.dance).rotationY).toBeCloseTo(4 * Math.PI);
  });

  it('never produces NaN, even long after a temporary phase should have ended', () => {
    const phases: Phase[] = ['idle', 'entering', 'ready-jump', 'ghost', 'leaving', 'dance'];
    for (const phase of phases) {
      for (const t of [-50, 0, 1, 500, 5000, 1e7]) {
        const p = pose(state(phase, 0), t);
        [...p.position, p.rotationY, p.headYaw, p.scale, p.armRaise, p.armSwing, p.ghost].forEach((v) => expect(Number.isFinite(v)).toBe(true));
      }
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d/pose.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/features/game/scene3d/pose.ts`:

```ts
import type { AvatarLook } from './avatar-look';
import { DOOR, slotPosition, type Vec3 } from './slots';

export type Phase = 'idle' | 'entering' | 'ready-jump' | 'ghost' | 'leaving' | 'dance';

export interface AvatarState {
  userId: string;
  slot: number;
  look: AvatarLook;
  phase: Phase;
  /** ms (mesmo relógio de `now`) em que a fase começou. */
  phaseStart: number;
  isHost: boolean;
  connected: boolean;
  hasCard: boolean;
  /** Até quando (ms) a cabeça fica virada para a porta (reação a quem entrou). */
  lookAtDoorUntil: number;
}

export const PHASE_MS = { entering: 1800, 'ready-jump': 600, leaving: 2200, dance: 1500 } as const;
export const TEMPORARY_PHASES: readonly Phase[] = ['entering', 'ready-jump', 'dance'];
const WAVE_MS = 800;

export interface Pose {
  position: Vec3;
  rotationY: number;
  headYaw: number;
  scale: number;
  /** 0 = braços abaixados, 1 = braço direito erguido (aceno). */
  armRaise: number;
  /** Balanço dos braços em radianos (andar/acenar). */
  armSwing: number;
  /** 0 = cor normal, 1 = fantasma (cor pálida). */
  ghost: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const heading = (from: Vec3, to: Vec3) => Math.atan2(to[0] - from[0], to[2] - from[2]);

function idlePose(slot: Vec3, s: AvatarState, now: number): Pose {
  const phase = s.look.seed * Math.PI * 2;
  const breathing = 1 + 0.02 * Math.sin(now / 600 + phase);
  const lookingAtDoor = now < s.lookAtDoorUntil;
  const doorYaw = Math.max(-1.2, Math.min(1.2, heading(slot, DOOR)));
  return {
    position: slot,
    rotationY: 0,
    headYaw: lookingAtDoor ? doorYaw : 0.15 * Math.sin(now / 1700 + phase * 5),
    scale: breathing,
    armRaise: 0,
    armSwing: 0,
    ghost: 0,
  };
}

/** Pose do avatar no instante `now` (ms). Pura: mesmo estado + mesmo `now` → mesma pose, em qualquer aparelho e FPS. */
export function pose(s: AvatarState, now: number): Pose {
  const slot = slotPosition(s.slot);
  const dt = Math.max(0, now - s.phaseStart);

  switch (s.phase) {
    case 'entering': {
      const p = clamp01(dt / PHASE_MS.entering);
      const pos = lerp3(DOOR, slot, ease(p));
      const hop = Math.abs(Math.sin(p * Math.PI * 6)) * 0.15 * (1 - p);
      const travel = heading(DOOR, slot);
      return {
        position: [pos[0], pos[1] + hop, pos[2]],
        rotationY: p < 0.85 ? travel : travel * (1 - (p - 0.85) / 0.15),
        headYaw: 0,
        scale: 1,
        armRaise: 0,
        armSwing: p < 1 ? 0.6 * Math.sin(dt / 120) : 0,
        ghost: 0,
      };
    }
    case 'ready-jump': {
      const p = clamp01(dt / PHASE_MS['ready-jump']);
      const base = idlePose(slot, s, now);
      return { ...base, position: [slot[0], slot[1] + 2.4 * p * (1 - p), slot[2]], armRaise: p < 1 ? 1 : 0 };
    }
    case 'ghost':
      return {
        position: [slot[0], slot[1] + 0.15 + 0.08 * Math.sin(now / 500 + s.look.seed * 6), slot[2]],
        rotationY: 0,
        headYaw: 0,
        scale: 0.95,
        armRaise: 0,
        armSwing: 0,
        ghost: 1,
      };
    case 'leaving': {
      if (dt < WAVE_MS) {
        return { position: slot, rotationY: 0, headYaw: 0, scale: 1, armRaise: 1, armSwing: 0.5 * Math.sin((dt / WAVE_MS) * Math.PI * 4), ghost: 0 };
      }
      const p = clamp01((dt - WAVE_MS) / (PHASE_MS.leaving - WAVE_MS));
      return {
        position: lerp3(slot, DOOR, ease(p)),
        rotationY: heading(slot, DOOR),
        headYaw: 0,
        scale: p < 0.8 ? 1 : Math.max(0, 1 - (p - 0.8) / 0.2),
        armRaise: 0,
        armSwing: 0.6 * Math.sin(dt / 120),
        ghost: 0,
      };
    }
    case 'dance': {
      const p = clamp01(dt / PHASE_MS.dance);
      return {
        position: [slot[0], slot[1] + Math.abs(Math.sin(p * Math.PI * 2)) * 0.4, slot[2]],
        rotationY: p * 4 * Math.PI,
        headYaw: 0,
        scale: 1,
        armRaise: p < 1 ? 1 : 0,
        armSwing: 0.8 * Math.sin(dt / 90),
        ghost: 0,
      };
    }
    case 'idle':
    default:
      return idlePose(slot, s, now);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game/scene3d/pose.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/game/scene3d/pose.ts src/features/game/scene3d/pose.test.ts
git commit -m "feat(scene3d): pure avatar poses for enter, idle, ready, ghost, leave and dance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Coreógrafo e ambiente (regras de fase, reações, rótulos, lâmpadas, confete)

**Files:**
- Create: `src/features/game/scene3d/choreographer.ts`, `choreographer.test.ts`, `ambience.ts`, `ambience.test.ts`

**Interfaces:**
- Consumes: `AvatarState`, `Phase`, `PHASE_MS`, `TEMPORARY_PHASES` (Task 2); `avatarFromId` (Task 1); `Vec3` (Task 1).
- Produces:
  - `interface SceneMember { userId: string; slot: number; connected: boolean; hasCard: boolean }`
  - `interface ChoreoInput { members: SceneMember[]; hostId: string; now: number }`
  - `choreograph(prev: ReadonlyMap<string, AvatarState> | null, input: ChoreoInput): Map<string, AvatarState>`
  - `triggerDance(states: ReadonlyMap<string, AvatarState>, userId: string, myUserId: string, now: number): Map<string, AvatarState>`
  - `statesChanged(a: ReadonlyMap<string, AvatarState> | null, b: ReadonlyMap<string, AvatarState>): boolean`
  - `labelIds(states: Iterable<AvatarState>, myUserId: string | null, showAll: boolean): Set<string>`
  - `LOOK_AT_DOOR_MS = 1000`
  - `bulbLevel(index: number, now: number): number` (0,35–1), `confettiParticle(index: number, elapsedMs: number): { position: Vec3; rotation: Vec3; colorIndex: number }`, `CONFETTI_COLORS`

- [ ] **Step 1: Testes que falham**

`src/features/game/scene3d/choreographer.test.ts`:

```ts
import { PHASE_MS } from './pose';
import { choreograph, labelIds, statesChanged, triggerDance, type SceneMember } from './choreographer';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const m = (userId: string, slot: number, extra: Partial<SceneMember> = {}): SceneMember => ({ userId, slot, connected: true, hasCard: false, ...extra });

describe('choreograph', () => {
  it('first snapshot: everyone already in place (idle, or ghost if offline), no parade', () => {
    const s = choreograph(null, { members: [m(A, 0), m(B, 1, { connected: false })], hostId: A, now: 0 });
    expect(s.get(A)?.phase).toBe('idle');
    expect(s.get(B)?.phase).toBe('ghost');
  });

  it('a newcomer enters, and the others look at the door', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0), m(B, 1)], hostId: A, now: 5000 });
    expect(s1.get(B)).toMatchObject({ phase: 'entering', phaseStart: 5000 });
    expect(s1.get(A)?.lookAtDoorUntil).toBe(6000);
  });

  it('entering settles into idle after its duration', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0), m(B, 1)], hostId: A, now: 100 });
    const s2 = choreograph(s1, { members: [m(A, 0), m(B, 1)], hostId: A, now: 100 + PHASE_MS.entering });
    expect(s2.get(B)?.phase).toBe('idle');
  });

  it('does not restart an animation when the same state arrives again', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0), m(B, 1)], hostId: A, now: 100 });
    const s2 = choreograph(s1, { members: [m(A, 0), m(B, 1)], hostId: A, now: 400 });
    expect(s2.get(B)).toMatchObject({ phase: 'entering', phaseStart: 100 });
  });

  it('jumps once when the player becomes ready', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0, { hasCard: true })], hostId: A, now: 50 });
    expect(s1.get(A)).toMatchObject({ phase: 'ready-jump', phaseStart: 50 });
    const s2 = choreograph(s1, { members: [m(A, 0, { hasCard: true })], hostId: A, now: 60 });
    expect(s2.get(A)?.phaseStart).toBe(50);
  });

  it('disconnect → ghost; reconnection goes idle without entering', () => {
    const s0 = choreograph(null, { members: [m(A, 0), m(B, 1)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0), m(B, 1, { connected: false })], hostId: A, now: 10 });
    expect(s1.get(B)?.phase).toBe('ghost');
    const s2 = choreograph(s1, { members: [m(A, 0), m(B, 1)], hostId: A, now: 20 });
    expect(s2.get(B)).toMatchObject({ phase: 'idle', phaseStart: 20 });
  });

  it('someone who left waves out and is removed after the animation', () => {
    const s0 = choreograph(null, { members: [m(A, 0), m(B, 1)], hostId: A, now: 0 });
    const s1 = choreograph(s0, { members: [m(A, 0)], hostId: A, now: 100 });
    expect(s1.get(B)).toMatchObject({ phase: 'leaving', phaseStart: 100 });
    const s2 = choreograph(s1, { members: [m(A, 0)], hostId: A, now: 100 + PHASE_MS.leaving - 1 });
    expect(s2.has(B)).toBe(true);
    const s3 = choreograph(s2, { members: [m(A, 0)], hostId: A, now: 100 + PHASE_MS.leaving });
    expect(s3.has(B)).toBe(false);
  });

  it('the crown follows the host', () => {
    const s0 = choreograph(null, { members: [m(A, 0), m(B, 1)], hostId: A, now: 0 });
    expect(s0.get(A)?.isHost).toBe(true);
    const s1 = choreograph(s0, { members: [m(B, 1)], hostId: B, now: 10 });
    expect(s1.get(B)?.isHost).toBe(true);
    expect(s1.get(A)?.isHost).toBe(false);
  });

  it('keeps the same look object for a returning member', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    expect(choreograph(s0, { members: [m(A, 0)], hostId: A, now: 1 }).get(A)?.look).toBe(s0.get(A)?.look);
  });
});

describe('triggerDance', () => {
  const s0 = choreograph(null, { members: [m(A, 0), m(B, 1)], hostId: A, now: 0 });

  it('makes my own avatar dance', () => {
    expect(triggerDance(s0, A, A, 10).get(A)).toMatchObject({ phase: 'dance', phaseStart: 10 });
  });

  it("ignores taps on someone else's avatar", () => {
    expect(triggerDance(s0, B, A, 10)).toBe(s0);
  });

  it('does not interrupt an entrance or a ghost', () => {
    const s1 = choreograph(s0, { members: [m(A, 0, { connected: false }), m(B, 1)], hostId: A, now: 5 });
    expect(triggerDance(s1, A, A, 10).get(A)?.phase).toBe('ghost');
  });
});

describe('statesChanged', () => {
  it('detects membership and phase changes, ignores identical maps', () => {
    const s0 = choreograph(null, { members: [m(A, 0)], hostId: A, now: 0 });
    expect(statesChanged(null, s0)).toBe(true);
    expect(statesChanged(s0, choreograph(s0, { members: [m(A, 0)], hostId: A, now: 1 }))).toBe(false);
    expect(statesChanged(s0, choreograph(s0, { members: [m(A, 0), m(B, 1)], hostId: A, now: 1 }))).toBe(true);
    expect(statesChanged(s0, triggerDance(s0, A, A, 2))).toBe(true);
  });
});

describe('labelIds', () => {
  const crowd = choreograph(null, { members: [m(A, 0), m(B, 1), m(C, 2)], hostId: B, now: 0 });

  it('shows everyone when allowed', () => {
    expect(labelIds(crowd.values(), A, true)).toEqual(new Set([A, B, C]));
  });

  it('otherwise only me, the host and whoever is arriving', () => {
    const arriving = choreograph(crowd, { members: [m(A, 0), m(B, 1), m(C, 2), m('00000000-0000-4000-8000-00000000000d', 3)], hostId: B, now: 10 });
    expect(labelIds(arriving.values(), A, false)).toEqual(new Set([A, B, '00000000-0000-4000-8000-00000000000d']));
  });
});
```

`src/features/game/scene3d/ambience.test.ts`:

```ts
import { CONFETTI_COLORS, bulbLevel, confettiParticle } from './ambience';

describe('bulbLevel', () => {
  it('stays within [0.35, 1] and differs between neighbours (a chasing wave)', () => {
    for (let i = 0; i < 30; i++) for (const t of [0, 90, 1000, 123456]) {
      const v = bulbLevel(i, t);
      expect(v).toBeGreaterThanOrEqual(0.35);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(bulbLevel(0, 500)).not.toBeCloseTo(bulbLevel(3, 500));
  });
});

describe('confettiParticle', () => {
  it('is deterministic and stays inside the hall', () => {
    expect(confettiParticle(5, 1234)).toEqual(confettiParticle(5, 1234));
    for (let i = 0; i < 300; i++) for (const t of [0, 800, 5000]) {
      const p = confettiParticle(i, t);
      expect(p.position[1]).toBeGreaterThanOrEqual(0);
      expect(p.position[1]).toBeLessThanOrEqual(7);
      expect(Math.abs(p.position[0])).toBeLessThanOrEqual(6.5);
      expect(p.colorIndex).toBeGreaterThanOrEqual(0);
      expect(p.colorIndex).toBeLessThan(CONFETTI_COLORS.length);
    }
  });

  it('falls over time', () => {
    expect(confettiParticle(1, 100).position[1]).toBeGreaterThan(confettiParticle(1, 600).position[1] - 7);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d/choreographer.test.ts src/features/game/scene3d/ambience.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`src/features/game/scene3d/choreographer.ts`:

```ts
import { avatarFromId } from './avatar-look';
import { PHASE_MS, TEMPORARY_PHASES, type AvatarState, type Phase } from './pose';

export interface SceneMember {
  userId: string;
  slot: number;
  connected: boolean;
  hasCard: boolean;
}

export interface ChoreoInput {
  members: SceneMember[];
  hostId: string;
  now: number;
}

export const LOOK_AT_DOOR_MS = 1000;

function settle(old: AvatarState, now: number): { phase: Phase; phaseStart: number } {
  if (TEMPORARY_PHASES.includes(old.phase) && now - old.phaseStart >= PHASE_MS[old.phase as keyof typeof PHASE_MS]) {
    return { phase: old.connected ? 'idle' : 'ghost', phaseStart: now };
  }
  return { phase: old.phase, phaseStart: old.phaseStart };
}

/**
 * Deriva o estado de animação de cada avatar a partir do snapshot da sala (store) e do estado anterior.
 * `prev === null` é o primeiro snapshot ao entrar: todos já estão no lugar (sem desfile de entradas).
 */
export function choreograph(prev: ReadonlyMap<string, AvatarState> | null, { members, hostId, now }: ChoreoInput): Map<string, AvatarState> {
  const next = new Map<string, AvatarState>();
  const arrived: string[] = [];

  for (const member of members) {
    const old = prev?.get(member.userId);
    let phase: Phase;
    let phaseStart: number;

    if (!old || old.phase === 'leaving') {
      if (prev === null) {
        phase = member.connected ? 'idle' : 'ghost';
      } else {
        phase = 'entering';
        arrived.push(member.userId);
      }
      phaseStart = now;
    } else {
      ({ phase, phaseStart } = settle(old, now));
      if (!member.connected) {
        if (phase !== 'ghost') [phase, phaseStart] = ['ghost', now];
      } else if (phase === 'ghost') {
        [phase, phaseStart] = ['idle', now];
      } else if (member.hasCard && !old.hasCard && phase === 'idle') {
        [phase, phaseStart] = ['ready-jump', now];
      }
    }

    next.set(member.userId, {
      userId: member.userId,
      slot: member.slot,
      look: old?.look ?? avatarFromId(member.userId),
      phase,
      phaseStart,
      isHost: member.userId === hostId,
      connected: member.connected,
      hasCard: member.hasCard,
      lookAtDoorUntil: old?.lookAtDoorUntil ?? 0,
    });
  }

  for (const [userId, old] of prev ?? []) {
    if (next.has(userId)) continue;
    if (old.phase !== 'leaving') next.set(userId, { ...old, phase: 'leaving', phaseStart: now, isHost: false });
    else if (now - old.phaseStart < PHASE_MS.leaving) next.set(userId, old);
  }

  if (arrived.length > 0) {
    for (const [userId, s] of next) {
      if (!arrived.includes(userId) && s.phase === 'idle') next.set(userId, { ...s, lookAtDoorUntil: now + LOOK_AT_DOOR_MS });
    }
  }
  return next;
}

/** Toque no avatar: só o meu, e só quando está parado. Retorna o mesmo Map se nada mudou. */
export function triggerDance(states: ReadonlyMap<string, AvatarState>, userId: string, myUserId: string, now: number): Map<string, AvatarState> {
  const current = states.get(userId);
  if (userId !== myUserId || !current || current.phase !== 'idle') return states as Map<string, AvatarState>;
  const next = new Map(states);
  next.set(userId, { ...current, phase: 'dance', phaseStart: now });
  return next;
}

/** Mudou algo que exige re-render (entrou/saiu alguém, mudou fase ou coroa)? Pose por frame não conta. */
export function statesChanged(a: ReadonlyMap<string, AvatarState> | null, b: ReadonlyMap<string, AvatarState>): boolean {
  if (!a || a.size !== b.size) return true;
  for (const [id, s] of b) {
    const o = a.get(id);
    if (!o || o.phase !== s.phase || o.phaseStart !== s.phaseStart || o.isHost !== s.isHost) return true;
  }
  return false;
}

/** Rótulos visíveis: todos, ou (sala cheia no celular) só o meu, o do host e de quem está chegando. */
export function labelIds(states: Iterable<AvatarState>, myUserId: string | null, showAll: boolean): Set<string> {
  const ids = new Set<string>();
  for (const s of states) {
    if (s.phase === 'leaving') continue;
    if (showAll || s.userId === myUserId || s.isHost || s.phase === 'entering') ids.add(s.userId);
  }
  return ids;
}
```

Nota: o teste `labelIds … shows everyone` usa um mapa sem ninguém saindo; quem está `leaving` nunca tem rótulo (está indo embora).

`src/features/game/scene3d/ambience.ts`:

```ts
import type { Vec3 } from './slots';

export const CONFETTI_COLORS = ['#fde047', '#f472b6', '#60a5fa', '#34d399', '#fb923c'] as const;

/** Onda de "lâmpadas de game show": cada lâmpada atrasada em relação à vizinha. */
export function bulbLevel(index: number, now: number): number {
  return 0.35 + 0.65 * Math.max(0, Math.sin(now / 180 - index * 0.6));
}

function rand(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Confete caindo em loop dentro do salão; determinístico por índice. */
export function confettiParticle(index: number, elapsedMs: number): { position: Vec3; rotation: Vec3; colorIndex: number } {
  const t = elapsedMs / 1000;
  const fall = 1.2 + rand(index, 3) * 1.2;
  const y = 7 - ((t * fall + rand(index, 4) * 7) % 7);
  const sway = Math.sin(t * 2 + rand(index, 5) * 6) * 0.3;
  return {
    position: [(rand(index, 1) - 0.5) * 12 + sway, y, (rand(index, 2) - 0.5) * 6],
    rotation: [t * (2 + rand(index, 6) * 3), t * (1 + rand(index, 7) * 2), 0],
    colorIndex: Math.floor(rand(index, 8) * CONFETTI_COLORS.length),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game/scene3d`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/game/scene3d/choreographer.ts src/features/game/scene3d/choreographer.test.ts src/features/game/scene3d/ambience.ts src/features/game/scene3d/ambience.test.ts
git commit -m "feat(scene3d): choreographer for lobby presence, dance taps, labels and ambience

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Modo de exibição, qualidade, preferências e bots de carga

**Files:**
- Create: `src/features/game/scene3d/display-mode.ts`, `display-mode.test.ts`, `quality.ts`, `quality.test.ts`, `scene-prefs.ts`, `scene-prefs.test.ts`, `bots.ts`, `bots.test.ts`

**Interfaces:**
- Consumes: `SceneMember` (Task 3), `MAX_SLOTS` (Task 1).
- Produces:
  - `type DisplayMode = '3d' | '2d'`, `type DisplayReason = 'ok' | 'no-webgl2' | 'reduced-motion' | 'user' | 'context-lost'`, `interface DisplaySignals { webgl2: boolean; reducedMotion: boolean; preferred: DisplayMode | null; contextLosses: number }`, `pickDisplayMode(s: DisplaySignals): { mode: DisplayMode; reason: DisplayReason }`
  - `type Tier = 'high' | 'medium' | 'low'`, `type QualityOverride = 'auto' | Tier`, `TIER_SETTINGS: Record<Tier, TierSettings>`, `interface TierSettings { maxDpr: number; minDpr: number; shadows: 'real' | 'fake' | 'none'; animatedBulbs: boolean; confetti: number; antialias: boolean }`, `interface DeviceSignals { cores: number; memoryGb: number | null; screenWidth: number }`, `pickInitialTier(s: DeviceSignals): Tier`, `interface QualityState { tier: Tier; dpr: number }`, `initialQuality(tier: Tier, devicePixelRatio: number): QualityState`, `stepDown(q: QualityState): QualityState`, `stepUp(q: QualityState): QualityState`
  - `readPreferredMode(): DisplayMode | null`, `writePreferredMode(m: DisplayMode): void`, `readQualityOverride(): QualityOverride`, `writeQualityOverride(q: QualityOverride): void`
  - `parseBots(search: string, enabled: boolean): number`, `botMembers(count: number, takenSlots: number[]): SceneMember[]`, `botName(userId: string): string | null`, `BOT_ID_PREFIX`

- [ ] **Step 1: Testes que falham**

`src/features/game/scene3d/display-mode.test.ts`:

```ts
import { pickDisplayMode, type DisplaySignals } from './display-mode';

const base: DisplaySignals = { webgl2: true, reducedMotion: false, preferred: null, contextLosses: 0 };

describe('pickDisplayMode', () => {
  it('3D by default', () => expect(pickDisplayMode(base)).toEqual({ mode: '3d', reason: 'ok' }));
  it('2D without WebGL2, even if the user asked for 3D', () =>
    expect(pickDisplayMode({ ...base, webgl2: false, preferred: '3d' })).toEqual({ mode: '2d', reason: 'no-webgl2' }));
  it('2D after two context losses', () => expect(pickDisplayMode({ ...base, contextLosses: 2 })).toEqual({ mode: '2d', reason: 'context-lost' }));
  it('one context loss is retried in 3D', () => expect(pickDisplayMode({ ...base, contextLosses: 1 }).mode).toBe('3d'));
  it('2D when the user chose it', () => expect(pickDisplayMode({ ...base, preferred: '2d' })).toEqual({ mode: '2d', reason: 'user' }));
  it('2D with reduced motion', () => expect(pickDisplayMode({ ...base, reducedMotion: true })).toEqual({ mode: '2d', reason: 'reduced-motion' }));
  it('an explicit 3D choice wins over reduced motion', () =>
    expect(pickDisplayMode({ ...base, reducedMotion: true, preferred: '3d' })).toEqual({ mode: '3d', reason: 'ok' }));
});
```

`src/features/game/scene3d/quality.test.ts`:

```ts
import { TIER_SETTINGS, initialQuality, pickInitialTier, stepDown, stepUp } from './quality';

describe('pickInitialTier', () => {
  it('high on strong devices', () => expect(pickInitialTier({ cores: 8, memoryGb: 8, screenWidth: 1440 })).toBe('high'));
  it('unknown memory (Safari) is not held against the device', () => expect(pickInitialTier({ cores: 8, memoryGb: null, screenWidth: 1440 })).toBe('high'));
  it('low on weak devices', () => {
    expect(pickInitialTier({ cores: 4, memoryGb: 8, screenWidth: 1440 })).toBe('low');
    expect(pickInitialTier({ cores: 8, memoryGb: 2, screenWidth: 1440 })).toBe('low');
  });
  it('medium in between', () => expect(pickInitialTier({ cores: 6, memoryGb: 4, screenWidth: 1440 })).toBe('medium'));
  it('small screens are capped at medium', () => expect(pickInitialTier({ cores: 8, memoryGb: 8, screenWidth: 390 })).toBe('medium'));
});

describe('initialQuality', () => {
  it('starts at min(devicePixelRatio, 1.5, tier max)', () => {
    expect(initialQuality('high', 3)).toEqual({ tier: 'high', dpr: 1.5 });
    expect(initialQuality('low', 3)).toEqual({ tier: 'low', dpr: 1 });
    expect(initialQuality('medium', 1)).toEqual({ tier: 'medium', dpr: 1 });
  });
});

describe('stepDown / stepUp', () => {
  it('lowers resolution first, then the tier, never below low/min', () => {
    let q = initialQuality('high', 2); // 1.5
    q = stepDown(q);
    expect(q).toEqual({ tier: 'high', dpr: 1.25 });
    q = stepDown(stepDown(q)); // 1.0 → high min is 1 → tier down
    expect(q.tier).toBe('medium');
    for (let i = 0; i < 20; i++) q = stepDown(q);
    expect(q).toEqual({ tier: 'low', dpr: TIER_SETTINGS.low.minDpr });
  });

  it('raises resolution up to the tier max', () => {
    let q = { tier: 'medium' as const, dpr: 1 };
    for (let i = 0; i < 10; i++) q = stepUp(q);
    expect(q).toEqual({ tier: 'medium', dpr: TIER_SETTINGS.medium.maxDpr });
  });
});
```

`src/features/game/scene3d/scene-prefs.test.ts`:

```ts
import { readPreferredMode, readQualityOverride, writePreferredMode, writeQualityOverride } from './scene-prefs';

describe('scene-prefs', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips the preferences', () => {
    expect(readPreferredMode()).toBeNull();
    expect(readQualityOverride()).toBe('auto');
    writePreferredMode('2d');
    writeQualityOverride('low');
    expect(readPreferredMode()).toBe('2d');
    expect(readQualityOverride()).toBe('low');
  });

  it('ignores garbage values', () => {
    localStorage.setItem('go-bingo:scene-mode', 'vr');
    localStorage.setItem('go-bingo:scene-quality', 'ultra');
    expect(readPreferredMode()).toBeNull();
    expect(readQualityOverride()).toBe('auto');
  });

  it('falls back to defaults when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPreferredMode()).toBeNull();
    expect(readQualityOverride()).toBe('auto');
    expect(() => writePreferredMode('3d')).not.toThrow();
    expect(() => writeQualityOverride('high')).not.toThrow();
  });
});
```

`src/features/game/scene3d/bots.test.ts`:

```ts
import { BOT_ID_PREFIX, botMembers, botName, parseBots } from './bots';

describe('parseBots', () => {
  it('reads ?bots=N only when enabled, clamped to 1..25', () => {
    expect(parseBots('?bots=25', true)).toBe(25);
    expect(parseBots('?bots=99', true)).toBe(25);
    expect(parseBots('?bots=0', true)).toBe(0);
    expect(parseBots('?bots=abc', true)).toBe(0);
    expect(parseBots('', true)).toBe(0);
    expect(parseBots('?bots=25', false)).toBe(0);
  });
});

describe('botMembers', () => {
  it('fills free slots with deterministic fake members', () => {
    const bots = botMembers(3, [0, 2]);
    expect(bots.map((b) => b.slot)).toEqual([1, 3, 4]);
    expect(bots.every((b) => b.userId.startsWith(BOT_ID_PREFIX) && b.connected && b.hasCard)).toBe(true);
    expect(botMembers(3, [0, 2])).toEqual(bots);
  });

  it('never exceeds the free slots', () => {
    expect(botMembers(30, [0])).toHaveLength(24);
  });
});

describe('botName', () => {
  it('names bots and ignores real ids', () => {
    expect(botName(botMembers(1, [])[0].userId)).toBe('Bot 1');
    expect(botName('00000000-0000-4000-8000-000000000001')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d`
Expected: FAIL nos 4 arquivos novos (módulos não existem).

- [ ] **Step 3: Implementar**

`src/features/game/scene3d/display-mode.ts`:

```ts
export type DisplayMode = '3d' | '2d';
export type DisplayReason = 'ok' | 'no-webgl2' | 'reduced-motion' | 'user' | 'context-lost';

export interface DisplaySignals {
  webgl2: boolean;
  reducedMotion: boolean;
  preferred: DisplayMode | null;
  contextLosses: number;
}

/** RNF-3D-06/08: decide 3D ou 2D antes de baixar o three.js. */
export function pickDisplayMode(s: DisplaySignals): { mode: DisplayMode; reason: DisplayReason } {
  if (!s.webgl2) return { mode: '2d', reason: 'no-webgl2' };
  if (s.contextLosses >= 2) return { mode: '2d', reason: 'context-lost' };
  if (s.preferred === '2d') return { mode: '2d', reason: 'user' };
  if (s.preferred === '3d') return { mode: '3d', reason: 'ok' };
  if (s.reducedMotion) return { mode: '2d', reason: 'reduced-motion' };
  return { mode: '3d', reason: 'ok' };
}
```

`src/features/game/scene3d/quality.ts`:

```ts
export type Tier = 'high' | 'medium' | 'low';
export type QualityOverride = 'auto' | Tier;

export interface TierSettings {
  maxDpr: number;
  minDpr: number;
  shadows: 'real' | 'fake' | 'none';
  animatedBulbs: boolean;
  confetti: number;
  antialias: boolean;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  high: { maxDpr: 2, minDpr: 1, shadows: 'real', animatedBulbs: true, confetti: 300, antialias: true },
  medium: { maxDpr: 1.5, minDpr: 0.75, shadows: 'fake', animatedBulbs: true, confetti: 120, antialias: true },
  low: { maxDpr: 1, minDpr: 0.75, shadows: 'none', animatedBulbs: false, confetti: 0, antialias: false },
};

const ORDER: Tier[] = ['low', 'medium', 'high'];
const DPR_STEP = 0.25;

export interface DeviceSignals {
  cores: number;
  /** `navigator.deviceMemory`; `null` quando o navegador não informa (Safari). */
  memoryGb: number | null;
  screenWidth: number;
}

/** Nível inicial sem rede (sem detect-gpu): sinais locais; o PerformanceMonitor corrige depois. */
export function pickInitialTier({ cores, memoryGb, screenWidth }: DeviceSignals): Tier {
  const memory = memoryGb ?? 8;
  let tier: Tier = 'medium';
  if (cores <= 4 || memory <= 3) tier = 'low';
  else if (cores >= 8 && memory >= 6) tier = 'high';
  if (tier === 'high' && screenWidth < 400) tier = 'medium';
  return tier;
}

export interface QualityState {
  tier: Tier;
  dpr: number;
}

/** RNF-3D-04: começa em min(devicePixelRatio, 1.5), respeitando o teto do nível. */
export function initialQuality(tier: Tier, devicePixelRatio: number): QualityState {
  return { tier, dpr: Math.min(devicePixelRatio, 1.5, TIER_SETTINGS[tier].maxDpr) };
}

export function stepDown(q: QualityState): QualityState {
  const settings = TIER_SETTINGS[q.tier];
  if (q.dpr - DPR_STEP >= settings.minDpr) return { tier: q.tier, dpr: q.dpr - DPR_STEP };
  const lower = ORDER[ORDER.indexOf(q.tier) - 1];
  if (!lower) return { tier: q.tier, dpr: settings.minDpr };
  return { tier: lower, dpr: Math.min(q.dpr, TIER_SETTINGS[lower].maxDpr) };
}

export function stepUp(q: QualityState): QualityState {
  return { tier: q.tier, dpr: Math.min(q.dpr + DPR_STEP, TIER_SETTINGS[q.tier].maxDpr) };
}
```

Conferência do teste `stepDown`: high 1,5 → 1,25 → 1,0 (= minDpr do high, ainda permitido) → próximo `stepDown`: 0,75 < 1 → desce para medium com dpr `min(1, 1.5) = 1`. O teste faz `stepDown(stepDown(q))` a partir de 1,25: 1,0 (high) e depois medium. ✔

`src/features/game/scene3d/scene-prefs.ts`:

```ts
import type { DisplayMode } from './display-mode';
import type { QualityOverride } from './quality';

const MODE_KEY = 'go-bingo:scene-mode';
const QUALITY_KEY = 'go-bingo:scene-quality';
const QUALITIES: QualityOverride[] = ['auto', 'high', 'medium', 'low'];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Armazenamento bloqueado: vale só nesta sessão.
  }
}

export function readPreferredMode(): DisplayMode | null {
  const value = read(MODE_KEY);
  return value === '3d' || value === '2d' ? value : null;
}

export function writePreferredMode(mode: DisplayMode) {
  write(MODE_KEY, mode);
}

export function readQualityOverride(): QualityOverride {
  const value = read(QUALITY_KEY) as QualityOverride | null;
  return value && QUALITIES.includes(value) ? value : 'auto';
}

export function writeQualityOverride(quality: QualityOverride) {
  write(QUALITY_KEY, quality);
}
```

`src/features/game/scene3d/bots.ts`:

```ts
import type { SceneMember } from './choreographer';
import { MAX_SLOTS } from './slots';

/** Prefixo dos ids falsos (formato de uuid, nunca gerado pelo Supabase). */
export const BOT_ID_PREFIX = 'b0000000-0000-4000-8000-';

/** `?bots=N` → total de bonecos desejado (inclui você). Só em dev ou com NEXT_PUBLIC_ENABLE_BOTS=1. */
export function parseBots(search: string, enabled: boolean): number {
  if (!enabled) return 0;
  const raw = Number(new URLSearchParams(search).get('bots'));
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(MAX_SLOTS, Math.floor(raw));
}

/** Membros falsos só para a cena (nunca vão à store, à HUD nem ao servidor). */
export function botMembers(count: number, takenSlots: number[]): SceneMember[] {
  const taken = new Set(takenSlots);
  const free = Array.from({ length: MAX_SLOTS }, (_, slot) => slot).filter((slot) => !taken.has(slot));
  return free.slice(0, Math.max(0, count)).map((slot, i) => ({
    userId: `${BOT_ID_PREFIX}${(i + 1).toString().padStart(12, '0')}`,
    slot,
    connected: true,
    hasCard: true,
  }));
}

export function botName(userId: string): string | null {
  return userId.startsWith(BOT_ID_PREFIX) ? `Bot ${Number(userId.slice(BOT_ID_PREFIX.length))}` : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game/scene3d`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/game/scene3d
git commit -m "feat(scene3d): display mode, adaptive quality tiers, scene prefs and load-test bots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hook `useAvatarStates` — store → coreógrafo, fora do ciclo de render

**Files:**
- Create: `src/features/game/scene3d/use-avatar-states.ts`, `src/features/game/scene3d/use-avatar-states.test.tsx`

**Interfaces:**
- Consumes: `useGameStore` (`src/features/game/store.ts`: `getState().snapshot`, `getState().myUserId`, `subscribe`); `choreograph`, `triggerDance`, `statesChanged` (Task 3); `botMembers` (Task 4); `AvatarState` (Task 2).
- Produces: `useAvatarStates(botTotal?: number, clock?: () => number): { statesRef: React.RefObject<Map<string, AvatarState>>; list: AvatarState[]; dance: (userId: string) => void }`. `statesRef` é lido por frame; `list` só muda quando `statesChanged` (para render de rótulos). `TICK_MS = 150`.

- [ ] **Step 1: Teste que falha**

`src/features/game/scene3d/use-avatar-states.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import type { RoomSnapshot } from '@/contracts';
import { initialGameState, reduce, useGameStore } from '../store';
import { BOT_ID_PREFIX } from './bots';
import { useAvatarStates } from './use-avatar-states';

const ME = '00000000-0000-4000-8000-000000000001';
const ANA = '00000000-0000-4000-8000-000000000002';
const member = (userId: string, slot: number) => ({ userId, nickname: userId === ME ? 'Eu' : 'Ana', slot, isGuest: false, connected: true, hasCard: false });

function room(members = [member(ME, 0)]): RoomSnapshot {
  return { code: 'ABC234', name: 'Sala', hostId: ME, maxPlayers: 25, isPublic: true, status: 'WAITING', members, myCard: null, game: null };
}

let now = 0;
const clock = () => now;

describe('useAvatarStates', () => {
  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
    useGameStore.setState(reduce(initialGameState(ME), { event: 'room:state', payload: room() }));
  });
  afterEach(() => vi.useRealTimers());

  it('starts from the current snapshot with everyone idle', () => {
    const { result } = renderHook(() => useAvatarStates(0, clock));
    expect(result.current.list.map((s) => [s.userId, s.phase])).toEqual([[ME, 'idle']]);
    expect(result.current.statesRef.current.get(ME)?.isHost).toBe(true);
  });

  it('reacts to store events without re-rendering every frame', () => {
    const { result } = renderHook(() => useAvatarStates(0, clock));
    now = 1000;
    act(() => useGameStore.getState().dispatch({ event: 'room:member_joined', payload: { member: member(ANA, 1), reconnected: false } }));
    expect(result.current.list.find((s) => s.userId === ANA)?.phase).toBe('entering');
    const before = result.current.list;
    now = 1100;
    act(() => vi.advanceTimersByTime(150)); // tick sem mudança de fase
    expect(result.current.list).toBe(before);
  });

  it('expires animations on its own tick', () => {
    const { result } = renderHook(() => useAvatarStates(0, clock));
    act(() => useGameStore.getState().dispatch({ event: 'room:member_joined', payload: { member: member(ANA, 1), reconnected: false } }));
    now = 5000;
    act(() => vi.advanceTimersByTime(150));
    expect(result.current.statesRef.current.get(ANA)?.phase).toBe('idle');
  });

  it('dance works only on my own avatar', () => {
    useGameStore.setState(reduce(initialGameState(ME), { event: 'room:state', payload: room([member(ME, 0), member(ANA, 1)]) }));
    const { result } = renderHook(() => useAvatarStates(0, clock));
    act(() => result.current.dance(ANA));
    expect(result.current.statesRef.current.get(ANA)?.phase).toBe('idle');
    act(() => result.current.dance(ME));
    expect(result.current.statesRef.current.get(ME)?.phase).toBe('dance');
  });

  it('adds load-test bots one per tick until the requested total', () => {
    const { result } = renderHook(() => useAvatarStates(4, clock));
    act(() => vi.advanceTimersByTime(150 * 5));
    const bots = result.current.list.filter((s) => s.userId.startsWith(BOT_ID_PREFIX));
    expect(bots).toHaveLength(3);
    expect(useGameStore.getState().snapshot?.members).toHaveLength(1); // bots nunca entram na store
  });

  it('stops listening on unmount', () => {
    const { result, unmount } = renderHook(() => useAvatarStates(0, clock));
    unmount();
    act(() => useGameStore.getState().dispatch({ event: 'room:member_joined', payload: { member: member(ANA, 1), reconnected: false } }));
    expect(result.current.statesRef.current.has(ANA)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/scene3d/use-avatar-states.test.tsx`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/features/game/scene3d/use-avatar-states.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store';
import { botMembers } from './bots';
import { choreograph, statesChanged, triggerDance } from './choreographer';
import type { AvatarState } from './pose';

export const TICK_MS = 150;
const defaultClock = () => performance.now();

/**
 * Assina a store fora do render, roda o coreógrafo e guarda o resultado num ref (lido a cada frame pelo R3F).
 * `list` só muda quando alguém entra/sai ou troca de fase — nunca a 60 Hz.
 */
export function useAvatarStates(botTotal = 0, clock: () => number = defaultClock) {
  const statesRef = useRef<Map<string, AvatarState>>(new Map());
  const initialized = useRef(false);
  const botsShown = useRef(0);
  const [list, setList] = useState<AvatarState[]>([]);

  const commit = useCallback((next: Map<string, AvatarState>) => {
    const changed = statesChanged(initialized.current ? statesRef.current : null, next);
    statesRef.current = next;
    initialized.current = true;
    if (changed) setList([...next.values()]);
  }, []);

  useEffect(() => {
    const recompute = () => {
      const { snapshot } = useGameStore.getState();
      if (!snapshot) return;
      const bots = botMembers(botsShown.current, snapshot.members.map((m) => m.slot));
      const members = [...snapshot.members, ...bots];
      commit(choreograph(initialized.current ? statesRef.current : null, { members, hostId: snapshot.hostId, now: clock() }));
    };
    recompute();
    const unsubscribe = useGameStore.subscribe(recompute);
    const tick = setInterval(() => {
      if (botsShown.current < botTotal - 1) botsShown.current += 1;
      recompute();
    }, TICK_MS);
    return () => {
      unsubscribe();
      clearInterval(tick);
    };
  }, [botTotal, clock, commit]);

  const dance = useCallback(
    (userId: string) => {
      const myUserId = useGameStore.getState().myUserId;
      if (!myUserId) return;
      commit(triggerDance(statesRef.current, userId, myUserId, clock()));
    },
    [clock, commit],
  );

  return { statesRef, list, dance };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game/scene3d`
Expected: PASS.

- [ ] **Step 5: Lint e commit**

Run: `npm run lint`
Expected: verde. (Se `react-hooks/refs` reclamar de leitura de ref fora de effect/callback, é falso positivo apenas se a leitura estiver dentro de `recompute`/`commit`/`dance` — que são callbacks. Não ler `statesRef.current` no corpo do hook.)

```bash
git add src/features/game/scene3d/use-avatar-states.ts src/features/game/scene3d/use-avatar-states.test.tsx
git commit -m "feat(scene3d): avatar state hook bridging the game store to the choreographer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cena — Canvas, salão, câmera e controle de qualidade

**Files:**
- Create: `src/features/game/scene3d/lobby-stage.tsx`, `hall.tsx`, `camera-rig.tsx`
- Modify: `vitest.config.mts`

**Interfaces:**
- Consumes: `cameraFor`, `orbitPosition` (Task 1); `bulbLevel` (Task 3); `TIER_SETTINGS`, `pickInitialTier`, `initialQuality`, `stepDown`, `stepUp`, `QualityOverride`, `QualityState` (Task 4); `parseBots` (Task 4); `useAvatarStates` (Task 5).
- Produces: `export default function LobbyStage(props: LobbyStageProps)` com `interface LobbyStageProps { roomName: string; code: string; celebrating: boolean; qualityOverride: QualityOverride; onContextLost: () => void }`. Tasks 7 e 8 consomem. Nesta task, `AvatarCrowd`/`NameLabels`/`Confetti` ainda não existem: o Canvas renderiza só salão + câmera (Task 7 adiciona os bonecos).

- [ ] **Step 1: Excluir os componentes R3F da cobertura**

`vitest.config.mts` — em `coverage.exclude`, acrescentar `'src/features/game/scene3d/**/*.tsx'` (componentes de renderização WebGL; toda regra está nos `.ts` puros, cobertos). Preservar o final de linha do arquivo.

- [ ] **Step 2: Implementar a câmera**

`src/features/game/scene3d/camera-rig.tsx`:

```tsx
'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { PerspectiveCamera } from 'three';
import { cameraFor, orbitPosition } from './camera';

const MAX_YAW = 0.26; // ~15°

/** Enquadra pelo aspect da região do canvas; arrasto horizontal gira até ±15° e volta com mola. */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const yaw = useRef(0);
  const targetYaw = useRef(0);
  const setup = cameraFor(size.width / Math.max(1, size.height));

  useEffect(() => {
    const el = gl.domElement;
    let startX: number | null = null;
    const down = (e: PointerEvent) => {
      startX = e.clientX;
    };
    const move = (e: PointerEvent) => {
      if (startX === null) return;
      const dx = (e.clientX - startX) / Math.max(1, el.clientWidth);
      targetYaw.current = Math.max(-MAX_YAW, Math.min(MAX_YAW, -dx * 0.8));
    };
    const up = () => {
      startX = null;
      targetYaw.current = 0;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl]);

  useFrame((_, delta) => {
    yaw.current += (targetYaw.current - yaw.current) * Math.min(1, delta * 8);
    if (camera.fov !== setup.fov) {
      camera.fov = setup.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(...orbitPosition(setup, yaw.current));
    camera.lookAt(...setup.target);
  });

  return null;
}
```

- [ ] **Step 3: Implementar o salão**

`src/features/game/scene3d/hall.tsx`:

```tsx
'use client';

import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh, type Mesh, type MeshStandardMaterial } from 'three';
import { bulbLevel } from './ambience';
import { DOOR } from './slots';

const BULBS = 28;
const BULB_COLOR = new Color('#fde68a');
const DIM = new Color('#78350f');

/** Salão de game show: chão, palco semicircular, telão (nome + código), globo parado, porta e lâmpadas. */
export function Hall({ roomName, code, animatedBulbs, receiveShadow }: { roomName: string; code: string; animatedBulbs: boolean; receiveShadow: boolean }) {
  const bulbs = useRef<InstancedMesh>(null);
  const globe = useRef<Mesh>(null);
  const bulbPositions = useMemo(
    () =>
      Array.from({ length: BULBS }, (_, i) => {
        const a = Math.PI * (i / (BULBS - 1));
        return [Math.cos(a) * -5.2, 0.35, -3.2 - Math.sin(a) * 1.6] as const;
      }),
    [],
  );

  useLayoutEffect(() => {
    const mesh = bulbs.current;
    if (!mesh) return;
    const o = new Object3D();
    bulbPositions.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, BULB_COLOR);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [bulbPositions]);

  const color = useMemo(() => new Color(), []);
  useFrame(() => {
    const now = performance.now();
    const mesh = bulbs.current;
    if (mesh && animatedBulbs) {
      for (let i = 0; i < BULBS; i++) mesh.setColorAt(i, color.copy(DIM).lerp(BULB_COLOR, bulbLevel(i, now)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    const material = globe.current?.material as MeshStandardMaterial | undefined;
    if (material) material.emissiveIntensity = 0.4 + 0.25 * Math.sin(now / 700);
  });

  return (
    <group>
      <ambientLight intensity={0.55} color="#fde7ff" />
      <directionalLight position={[4, 9, 6]} intensity={1.4} color="#fff1d6" castShadow={receiveShadow} shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 4, -3]} intensity={18} color="#f59e0b" distance={14} />

      {/* chão */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow={receiveShadow}>
        <planeGeometry args={[30, 20]} />
        <meshStandardMaterial color="#5b21b6" />
      </mesh>
      {/* degraus da plateia */}
      <mesh position={[0, 0.2, 0.2]}>
        <boxGeometry args={[10.5, 0.4, 1.2]} />
        <meshStandardMaterial color="#6d28d9" flatShading />
      </mesh>
      <mesh position={[0, 0.4, -1.2]}>
        <boxGeometry args={[10.5, 0.8, 1.2]} />
        <meshStandardMaterial color="#7c3aed" flatShading />
      </mesh>
      {/* palco */}
      <mesh position={[0, 0.15, -3.6]}>
        <cylinderGeometry args={[5.4, 5.4, 0.3, 24, 1, false, Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#be185d" flatShading />
      </mesh>
      {/* telão */}
      <mesh position={[0, 3.2, -5.2]}>
        <boxGeometry args={[7, 3, 0.2]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <Text position={[0, 3.9, -5.08]} fontSize={0.45} color="#fef3c7" anchorX="center" anchorY="middle" maxWidth={6.5}>
        {roomName}
      </Text>
      <Text position={[0, 2.9, -5.08]} fontSize={0.9} color="#fde047" anchorX="center" anchorY="middle" letterSpacing={0.12}>
        {code}
      </Text>
      {/* globo parado (gira no M4) */}
      <mesh ref={globe} position={[3.6, 1.3, -3.6]}>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.4} flatShading />
      </mesh>
      {/* porta */}
      <group position={[DOOR[0], 0, DOOR[2] - 0.8]}>
        <mesh position={[0, 1.2, 0]}>
          <boxGeometry args={[1.6, 2.4, 0.15]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
        <mesh position={[0, 1.1, 0.05]}>
          <boxGeometry args={[1.2, 2.1, 0.1]} />
          <meshStandardMaterial color="#1e1b4b" />
        </mesh>
      </group>
      {/* lâmpadas de game show */}
      <instancedMesh ref={bulbs} args={[undefined, undefined, BULBS]}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial />
      </instancedMesh>
    </group>
  );
}
```

- [ ] **Step 4: Implementar o Canvas**

`src/features/game/scene3d/lobby-stage.tsx`:

```tsx
'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { CameraRig } from './camera-rig';
import { Hall } from './hall';
import { TIER_SETTINGS, initialQuality, pickInitialTier, stepDown, stepUp, type QualityOverride, type QualityState } from './quality';

export interface LobbyStageProps {
  roomName: string;
  code: string;
  /** Partida começou: confete antes de trocar para a tela do jogo. */
  celebrating: boolean;
  qualityOverride: QualityOverride;
  onContextLost: () => void;
}

function deviceTier() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return pickInitialTier({ cores: nav.hardwareConcurrency || 4, memoryGb: nav.deviceMemory ?? null, screenWidth: window.innerWidth });
}

function startQuality(override: QualityOverride): QualityState {
  return initialQuality(override === 'auto' ? deviceTier() : override, window.devicePixelRatio || 1);
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

export default function LobbyStage({ roomName, code, celebrating, qualityOverride, onContextLost }: LobbyStageProps) {
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
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            onContextLost();
          },
          { once: true },
        );
      }}
    >
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
      <CameraRig />
      <Hall roomName={roomName} code={code} animatedBulbs={settings.animatedBulbs} receiveShadow={settings.shadows === 'real'} />
      {/* Task 7: <AvatarCrowd/>, <NameLabels/>, <Confetti/> — `celebrating` é usado lá. */}
      {celebrating ? null : null}
    </Canvas>
  );
}
```

- [ ] **Step 5: Verificar compilação**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: verde (nenhum teste novo; nada importa `LobbyStage` ainda). Se o tipo de `<Canvas aria-hidden role>` não aceitar as props, mover `aria-hidden`/`role` para um `<div>` wrapper dentro do componente e registrar no commit.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.mts src/features/game/scene3d/lobby-stage.tsx src/features/game/scene3d/hall.tsx src/features/game/scene3d/camera-rig.tsx
git commit -m "feat(scene3d): canvas with game-show hall, framing camera and adaptive quality

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Bonecos instanciados, rótulos e confete

**Files:**
- Create: `src/features/game/scene3d/avatar-crowd.tsx`, `name-labels.tsx`, `confetti.tsx`
- Modify: `src/features/game/scene3d/lobby-stage.tsx`

**Interfaces:**
- Consumes: `pose`, `AvatarState` (Task 2); `labelIds` (Task 3); `confettiParticle`, `CONFETTI_COLORS` (Task 3); `botName`, `parseBots` (Task 4); `useAvatarStates` (Task 5); `useGameStore` (`snapshot.members` para apelidos, `myUserId`).
- Produces: `AvatarCrowd({ statesRef, onTap, castShadow, fakeShadow })`, `NameLabels({ list, statesRef, showAll })`, `Confetti({ count })`.

- [ ] **Step 1: Implementar os bonecos**

`src/features/game/scene3d/avatar-crowd.tsx`:

```tsx
'use client';

import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Color, Euler, Matrix4, Object3D, Quaternion, Vector3, type InstancedMesh } from 'three';
import type { Hat } from './avatar-look';
import { pose, type AvatarState } from './pose';

export const MAX_AVATARS = 32; // 25 na sala + quem está saindo
const HAT_TYPES: Exclude<Hat, 'none'>[] = ['tophat', 'cap', 'beanie', 'party'];
const GHOST = new Color('#c4b5fd');
const GOLD = new Color('#facc15');
const ZERO = new Matrix4().makeScale(0, 0, 0);
const MOUTH: Record<AvatarState['look']['face'], [number, number, number]> = {
  smile: [0.1, 0.03, 0.04],
  grin: [0.15, 0.045, 0.04],
  wow: [0.055, 0.06, 0.04],
};

type Parts = {
  body: InstancedMesh | null;
  head: InstancedMesh | null;
  arms: InstancedMesh | null;
  eyes: InstancedMesh | null;
  mouth: InstancedMesh | null;
  crown: InstancedMesh | null;
  shadow: InstancedMesh | null;
  hats: Record<(typeof HAT_TYPES)[number], InstancedMesh | null>;
};

export function AvatarCrowd({
  statesRef,
  onTap,
  castShadow,
  fakeShadow,
}: {
  statesRef: RefObject<Map<string, AvatarState>>;
  onTap: (userId: string) => void;
  castShadow: boolean;
  fakeShadow: boolean;
}) {
  const parts = useRef<Parts>({ body: null, head: null, arms: null, eyes: null, mouth: null, crown: null, shadow: null, hats: { tophat: null, cap: null, beanie: null, party: null } });
  const ids = useRef<string[]>([]);
  const tmp = useMemo(
    () => ({ o: new Object3D(), base: new Matrix4(), head: new Matrix4(), local: new Matrix4(), out: new Matrix4(), q: new Quaternion(), e: new Euler(), v: new Vector3(), s: new Vector3(), color: new Color() }),
    [],
  );

  useLayoutEffect(() => {
    // instanceColor só existe depois do primeiro setColorAt; inicializa tudo escondido.
    const all = [parts.current.body, parts.current.head, parts.current.arms, parts.current.eyes, parts.current.mouth, parts.current.crown, parts.current.shadow, ...Object.values(parts.current.hats)];
    for (const mesh of all) {
      if (!mesh) continue;
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, ZERO);
        mesh.setColorAt(i, tmp.color.set('#ffffff'));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }, [tmp]);

  /** out = parent × T(offset) × R(rot) × S(scale) */
  function place(mesh: InstancedMesh | null, index: number, parent: Matrix4, offset: [number, number, number], rot: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
    if (!mesh) return;
    tmp.local.compose(tmp.v.set(...offset), tmp.q.setFromEuler(tmp.e.set(...rot)), tmp.s.set(...scale));
    tmp.out.multiplyMatrices(parent, tmp.local);
    mesh.setMatrixAt(index, tmp.out);
  }

  useFrame(() => {
    const p = parts.current;
    const now = performance.now();
    const states = [...(statesRef.current?.values() ?? [])].slice(0, MAX_AVATARS);
    ids.current = states.map((s) => s.userId);

    for (let i = 0; i < MAX_AVATARS; i++) {
      const s = states[i];
      if (!s) {
        for (const mesh of [p.body, p.head, p.mouth, p.crown, p.shadow, ...Object.values(p.hats)]) mesh?.setMatrixAt(i, ZERO);
        p.arms?.setMatrixAt(i * 2, ZERO);
        p.arms?.setMatrixAt(i * 2 + 1, ZERO);
        p.eyes?.setMatrixAt(i * 2, ZERO);
        p.eyes?.setMatrixAt(i * 2 + 1, ZERO);
        continue;
      }
      const ps = pose(s, now);
      tmp.base.compose(tmp.v.set(...ps.position), tmp.q.setFromEuler(tmp.e.set(0, ps.rotationY, 0)), tmp.s.setScalar(ps.scale));

      place(p.body, i, tmp.base, [0, 0.5, 0], [0, 0, 0]);
      const raise = -2.6 * ps.armRaise;
      place(p.arms, i * 2, tmp.base, [-0.33, 0.62, 0], [ps.armSwing * 0.5, 0, 0.18]);
      place(p.arms, i * 2 + 1, tmp.base, [0.33, 0.62, 0], [-ps.armSwing * 0.5, 0, -0.18 + raise + ps.armSwing * ps.armRaise]);

      // cabeça e tudo que vai nela gira junto (headYaw)
      tmp.local.compose(tmp.v.set(0, 1.08, 0), tmp.q.setFromEuler(tmp.e.set(0, ps.headYaw, 0)), tmp.s.set(1, 1, 1));
      tmp.head.multiplyMatrices(tmp.base, tmp.local);
      place(p.head, i, tmp.head, [0, 0, 0], [0, 0, 0]);
      place(p.eyes, i * 2, tmp.head, [-0.09, 0.05, 0.22], [0, 0, 0]);
      place(p.eyes, i * 2 + 1, tmp.head, [0.09, 0.05, 0.22], [0, 0, 0]);
      place(p.mouth, i, tmp.head, [0, -0.08, 0.23], [0, 0, 0], MOUTH[s.look.face]);

      for (const type of HAT_TYPES) {
        const mesh = p.hats[type];
        if (!mesh) continue;
        if (!s.isHost && s.look.hat === type) place(mesh, i, tmp.head, [0, 0.24, 0], type === 'cap' ? [-0.15, 0, 0] : [0, 0, 0]);
        else mesh.setMatrixAt(i, ZERO);
      }
      if (s.isHost) place(p.crown, i, tmp.head, [0, 0.27, 0], [0, 0, 0]);
      else p.crown?.setMatrixAt(i, ZERO);

      if (fakeShadow && p.shadow) {
        tmp.o.position.set(ps.position[0], 0.02, ps.position[2]);
        tmp.o.rotation.set(-Math.PI / 2, 0, 0);
        tmp.o.scale.setScalar(ps.scale);
        tmp.o.updateMatrix();
        p.shadow.setMatrixAt(i, tmp.o.matrix);
      }

      tmp.color.set(s.look.body).lerp(GHOST, ps.ghost);
      p.body?.setColorAt(i, tmp.color);
      p.head?.setColorAt(i, tmp.color);
      p.arms?.setColorAt(i * 2, tmp.color);
      p.arms?.setColorAt(i * 2 + 1, tmp.color);
      tmp.color.set(s.look.accent).lerp(GHOST, ps.ghost);
      for (const type of HAT_TYPES) p.hats[type]?.setColorAt(i, tmp.color);
      p.crown?.setColorAt(i, GOLD);
    }

    for (const mesh of [p.body, p.head, p.arms, p.eyes, p.mouth, p.crown, p.shadow, ...Object.values(p.hats)]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  const tap = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const id = event.instanceId === undefined ? undefined : ids.current[event.instanceId];
    if (id) onTap(id);
  };

  return (
    <group>
      <instancedMesh ref={(m) => void (parts.current.body = m)} args={[undefined, undefined, MAX_AVATARS]} castShadow={castShadow} onPointerDown={tap}>
        <capsuleGeometry args={[0.28, 0.35, 4, 8]} />
        <meshStandardMaterial flatShading roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.head = m)} args={[undefined, undefined, MAX_AVATARS]} castShadow={castShadow} onPointerDown={tap}>
        <sphereGeometry args={[0.26, 10, 8]} />
        <meshStandardMaterial flatShading roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.arms = m)} args={[undefined, undefined, MAX_AVATARS * 2]}>
        <capsuleGeometry args={[0.07, 0.3, 2, 6]} />
        <meshStandardMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.eyes = m)} args={[undefined, undefined, MAX_AVATARS * 2]}>
        <sphereGeometry args={[0.045, 6, 6]} />
        <meshBasicMaterial color="#0f172a" />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.mouth = m)} args={[undefined, undefined, MAX_AVATARS]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial color="#7f1d1d" />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.hats.tophat = m)} args={[undefined, undefined, MAX_AVATARS]}>
        <cylinderGeometry args={[0.17, 0.17, 0.3, 10]} />
        <meshStandardMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.hats.cap = m)} args={[undefined, undefined, MAX_AVATARS]}>
        <cylinderGeometry args={[0.27, 0.28, 0.1, 12]} />
        <meshStandardMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.hats.beanie = m)} args={[undefined, undefined, MAX_AVATARS]}>
        <sphereGeometry args={[0.27, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.hats.party = m)} args={[undefined, undefined, MAX_AVATARS]}>
        <coneGeometry args={[0.14, 0.38, 8]} />
        <meshStandardMaterial flatShading />
      </instancedMesh>
      <instancedMesh ref={(m) => void (parts.current.crown = m)} args={[undefined, undefined, MAX_AVATARS]}>
        <cylinderGeometry args={[0.2, 0.17, 0.18, 6, 1, true]} />
        <meshStandardMaterial metalness={0.6} roughness={0.3} side={2} />
      </instancedMesh>
      {fakeShadow && (
        <instancedMesh ref={(m) => void (parts.current.shadow = m)} args={[undefined, undefined, MAX_AVATARS]}>
          <circleGeometry args={[0.35, 16]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
        </instancedMesh>
      )}
    </group>
  );
}
```

- [ ] **Step 2: Implementar rótulos e confete**

`src/features/game/scene3d/name-labels.tsx`:

```tsx
'use client';

import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import type { Group } from 'three';
import { useGameStore } from '../store';
import { botName } from './bots';
import { labelIds } from './choreographer';
import { pose, type AvatarState } from './pose';

function Label({ userId, nickname, statesRef, isMe }: { userId: string; nickname: string; statesRef: RefObject<Map<string, AvatarState>>; isMe: boolean }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const s = statesRef.current?.get(userId);
    if (!group.current || !s) return;
    const p = pose(s, performance.now());
    group.current.position.set(p.position[0], p.position[1] + 1.65 * p.scale, p.position[2]);
    group.current.scale.setScalar(Math.max(0.001, p.scale));
  });
  return (
    <group ref={group}>
      <Billboard>
        <Text fontSize={0.22} color={isMe ? '#fde047' : '#ffffff'} outlineWidth={0.025} outlineColor="#1e1b4b" anchorX="center" anchorY="bottom" maxWidth={2.2}>
          {nickname}
        </Text>
      </Billboard>
    </group>
  );
}

/** Apelidos como texto (nunca HTML). Sala cheia no celular: só o meu, o do host e de quem chega. */
export function NameLabels({ list, statesRef, showAll }: { list: AvatarState[]; statesRef: RefObject<Map<string, AvatarState>>; showAll: boolean }) {
  const members = useGameStore((s) => s.snapshot?.members);
  const myUserId = useGameStore((s) => s.myUserId);
  const visible = labelIds(list, myUserId, showAll);
  return (
    <>
      {list
        .filter((s) => visible.has(s.userId))
        .map((s) => {
          const nickname = members?.find((m) => m.userId === s.userId)?.nickname ?? botName(s.userId) ?? '';
          return <Label key={s.userId} userId={s.userId} nickname={nickname} statesRef={statesRef} isMe={s.userId === myUserId} />;
        })}
    </>
  );
}
```

`src/features/game/scene3d/confetti.tsx`:

```tsx
'use client';

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, DoubleSide, Object3D, type InstancedMesh } from 'three';
import { CONFETTI_COLORS, confettiParticle } from './ambience';

/** Confete ao iniciar a partida (transição para a tela do jogo). */
export function Confetti({ count }: { count: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const start = useRef(0);
  const o = useMemo(() => new Object3D(), []);
  const colors = useMemo(() => CONFETTI_COLORS.map((c) => new Color(c)), []);

  useLayoutEffect(() => {
    start.current = performance.now();
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < count; i++) m.setColorAt(i, colors[confettiParticle(i, 0).colorIndex]);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [count, colors]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const elapsed = performance.now() - start.current;
    for (let i = 0; i < count; i++) {
      const p = confettiParticle(i, elapsed);
      o.position.set(...p.position);
      o.rotation.set(...p.rotation);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <planeGeometry args={[0.08, 0.12]} />
      <meshBasicMaterial side={DoubleSide} />
    </instancedMesh>
  );
}
```

- [ ] **Step 3: Compor no `LobbyStage`**

Em `src/features/game/scene3d/lobby-stage.tsx`:
- importar `AvatarCrowd`, `NameLabels`, `Confetti`, `useAvatarStates`, `parseBots`;
- antes do `return`, acrescentar:

```tsx
  const [bots] = useState(() => parseBots(window.location.search, process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_ENABLE_BOTS === '1'));
  const { statesRef, list, dance } = useAvatarStates(bots);
  const showAllLabels = quality.tier === 'high' || list.length <= 15;
```

- substituir a linha `{celebrating ? null : null}` e o comentário da Task 7 por:

```tsx
      <AvatarCrowd statesRef={statesRef} onTap={dance} castShadow={settings.shadows === 'real'} fakeShadow={settings.shadows === 'fake'} />
      <NameLabels list={list} statesRef={statesRef} showAll={showAllLabels} />
      {celebrating && settings.confetti > 0 && <Confetti count={settings.confetti} />}
```

- [ ] **Step 4: Verificar**

Run: `npm run lint && npm run typecheck && npx vitest run`
Expected: verde. (Componentes R3F não têm teste unitário — regra está nos `.ts`; a verificação visual é na Task 8/9.)

- [ ] **Step 5: Commit**

```bash
git add src/features/game/scene3d
git commit -m "feat(scene3d): instanced vinyl-toy avatars, billboard nicknames and start confetti

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Integração na sala — modo 3D/2D, lazy load, controles, perda de contexto e confete

**Files:**
- Create: `src/features/game/scene3d/lobby-stage-lazy.tsx`
- Create: `src/features/game/use-scene-mode.ts`, `use-scene-mode.test.tsx`, `use-celebration-delay.ts`, `use-celebration-delay.test.tsx`, `scene-controls.tsx`, `scene-controls.test.tsx`
- Modify: `src/features/game/room-screen.tsx`, `src/features/game/room-screen.test.tsx`

**Interfaces:**
- Consumes: `pickDisplayMode`, `DisplayMode`, `DisplayReason` (Task 4); `readPreferredMode`, `writePreferredMode`, `readQualityOverride`, `writeQualityOverride`, `QualityOverride` (Task 4); `LobbyStageProps` (Task 6).
- Produces:
  - `useSceneMode(): { mode: DisplayMode; reason: DisplayReason; setPreferred(m: DisplayMode): void; quality: QualityOverride; setQuality(q: QualityOverride): void; reportContextLoss(): void; stageKey: number }`
  - `useCelebrationDelay(inGame: boolean, enabled: boolean, delayMs?: number): boolean` (retorna "mostrar a partida"); `CELEBRATION_MS = 1200`
  - `<SceneControls mode quality onModeChange onQualityChange />`
  - `LobbyStageLazy` (componente `next/dynamic` com esqueleto)

- [ ] **Step 1: Testes que falham**

`src/features/game/use-scene-mode.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { useSceneMode } from './use-scene-mode';

function setWebgl2(ok: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => (type === 'webgl2' && ok ? ({} as WebGL2RenderingContext) : null)) as never);
}
function setReducedMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: on && q.includes('reduce'), media: q })) as unknown as typeof window.matchMedia;
}

describe('useSceneMode', () => {
  beforeEach(() => {
    localStorage.clear();
    setWebgl2(true);
    setReducedMotion(false);
  });
  afterEach(() => vi.restoreAllMocks());

  it('3D on a capable device', () => {
    expect(renderHook(() => useSceneMode()).result.current).toMatchObject({ mode: '3d', reason: 'ok', quality: 'auto' });
  });

  it('2D without WebGL2', () => {
    setWebgl2(false);
    expect(renderHook(() => useSceneMode()).result.current).toMatchObject({ mode: '2d', reason: 'no-webgl2' });
  });

  it('2D with reduced motion, unless the user picks 3D (persisted)', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useSceneMode());
    expect(result.current.mode).toBe('2d');
    act(() => result.current.setPreferred('3d'));
    expect(result.current.mode).toBe('3d');
    expect(localStorage.getItem('go-bingo:scene-mode')).toBe('3d');
  });

  it('first context loss remounts the stage; the second falls back to 2D', () => {
    const { result } = renderHook(() => useSceneMode());
    const key = result.current.stageKey;
    act(() => result.current.reportContextLoss());
    expect(result.current).toMatchObject({ mode: '3d' });
    expect(result.current.stageKey).not.toBe(key);
    act(() => result.current.reportContextLoss());
    expect(result.current).toMatchObject({ mode: '2d', reason: 'context-lost' });
  });

  it('persists the quality override', () => {
    const { result } = renderHook(() => useSceneMode());
    act(() => result.current.setQuality('low'));
    expect(result.current.quality).toBe('low');
    expect(localStorage.getItem('go-bingo:scene-quality')).toBe('low');
  });
});
```

`src/features/game/use-celebration-delay.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { CELEBRATION_MS, useCelebrationDelay } from './use-celebration-delay';

describe('useCelebrationDelay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('switches immediately when disabled (2D)', () => {
    const { result, rerender } = renderHook(({ inGame }) => useCelebrationDelay(inGame, false), { initialProps: { inGame: false } });
    rerender({ inGame: true });
    expect(result.current).toBe(true);
  });

  it('holds the lobby for the confetti, then switches', () => {
    const { result, rerender } = renderHook(({ inGame }) => useCelebrationDelay(inGame, true), { initialProps: { inGame: false } });
    rerender({ inGame: true });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(CELEBRATION_MS));
    expect(result.current).toBe(true);
  });

  it('does not delay when the room is already in game on arrival (reconnect)', () => {
    const { result } = renderHook(() => useCelebrationDelay(true, true));
    expect(result.current).toBe(true);
  });

  it('goes back to the lobby right away on replay', () => {
    const { result, rerender } = renderHook(({ inGame }) => useCelebrationDelay(inGame, true), { initialProps: { inGame: true } });
    rerender({ inGame: false });
    expect(result.current).toBe(false);
  });
});
```

`src/features/game/scene-controls.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SceneControls } from './scene-controls';

describe('SceneControls', () => {
  it('toggles between 3D and 2D', async () => {
    const onModeChange = vi.fn();
    render(<SceneControls mode="3d" quality="auto" onModeChange={onModeChange} onQualityChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver em 2D' }));
    expect(onModeChange).toHaveBeenCalledWith('2d');
  });

  it('offers the quality override only in 3D', async () => {
    const onQualityChange = vi.fn();
    const { rerender } = render(<SceneControls mode="3d" quality="auto" onModeChange={vi.fn()} onQualityChange={onQualityChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Qualidade 3D'), 'low');
    expect(onQualityChange).toHaveBeenCalledWith('low');
    rerender(<SceneControls mode="2d" quality="auto" onModeChange={vi.fn()} onQualityChange={onQualityChange} />);
    expect(screen.queryByLabelText('Qualidade 3D')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver em 3D' })).toBeInTheDocument();
  });
});
```

Em `src/features/game/room-screen.test.tsx`, acrescentar no topo (junto dos outros `vi.mock`):

```tsx
const sceneMode = vi.hoisted(() => ({
  value: { mode: '2d' as '2d' | '3d', reason: 'user' as string, setPreferred: vi.fn(), quality: 'auto', setQuality: vi.fn(), reportContextLoss: vi.fn(), stageKey: 0 },
}));
vi.mock('./use-scene-mode', () => ({ useSceneMode: () => sceneMode.value }));
vi.mock('./scene3d/lobby-stage-lazy', () => ({
  LobbyStageLazy: (props: { celebrating: boolean; onContextLost: () => void }) => (
    <div data-testid="lobby-stage" data-celebrating={String(props.celebrating)}>
      <button onClick={props.onContextLost}>perder contexto</button>
    </div>
  ),
}));
```

e, dentro do `describe('RoomScreen')`, acrescentar (o `beforeEach` existente já limpa os mocks; reatribuir o modo em cada teste):

```tsx
  it('2D mode: lobby HUD only, no canvas', () => {
    sceneMode.value = { ...sceneMode.value, mode: '2d', reason: 'user' };
    renderWith(room());
    expect(screen.queryByTestId('lobby-stage')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver em 3D' })).toBeInTheDocument();
  });

  it('3D mode: stage above the same lobby HUD', () => {
    sceneMode.value = { ...sceneMode.value, mode: '3d', reason: 'ok' };
    renderWith(room());
    expect(screen.getByTestId('lobby-stage')).toBeInTheDocument();
    expect(screen.getByText('Amigos')).toBeInTheDocument(); // HUD continua
  });

  it('reports a lost WebGL context', async () => {
    sceneMode.value = { ...sceneMode.value, mode: '3d', reason: 'ok' };
    renderWith(room());
    await userEvent.click(screen.getByRole('button', { name: 'perder contexto' }));
    expect(sceneMode.value.reportContextLoss).toHaveBeenCalled();
  });

  it('warns when it falls back to 2D after losing the context', () => {
    sceneMode.value = { ...sceneMode.value, mode: '2d', reason: 'context-lost' };
    renderWith(room());
    expect(toast).toHaveBeenCalledWith('Modo 2D ativado para economizar o aparelho');
  });
```

Se algum teste existente de `room-screen.test.tsx` passar a falhar só porque agora há um botão "Ver em 3D" a mais na tela (ex.: buscas por papel `button` sem nome), ajustar a busca daquele teste para o nome específico — não remover os controles.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/features/game/use-scene-mode.test.tsx src/features/game/use-celebration-delay.test.tsx src/features/game/scene-controls.test.tsx src/features/game/room-screen.test.tsx`
Expected: FAIL (módulos novos não existem; `RoomScreen` não renderiza palco/controles).

- [ ] **Step 3: Implementar**

`src/features/game/use-scene-mode.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';
import { pickDisplayMode, type DisplayMode } from './scene3d/display-mode';
import type { QualityOverride } from './scene3d/quality';
import { readPreferredMode, readQualityOverride, writePreferredMode, writeQualityOverride } from './scene3d/scene-prefs';

function hasWebgl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Decide 3D ou 2D (sem baixar o three.js), guarda preferências e conta perdas de contexto WebGL. */
export function useSceneMode() {
  const [webgl2] = useState(hasWebgl2);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [preferred, setPreferredState] = useState<DisplayMode | null>(readPreferredMode);
  const [quality, setQualityState] = useState<QualityOverride>(readQualityOverride);
  const [contextLosses, setContextLosses] = useState(0);

  const { mode, reason } = pickDisplayMode({ webgl2, reducedMotion, preferred, contextLosses });

  const setPreferred = useCallback((next: DisplayMode) => {
    writePreferredMode(next);
    setPreferredState(next);
  }, []);
  const setQuality = useCallback((next: QualityOverride) => {
    writeQualityOverride(next);
    setQualityState(next);
  }, []);
  const reportContextLoss = useCallback(() => setContextLosses((n) => n + 1), []);

  return { mode, reason, setPreferred, quality, setQuality, reportContextLoss, stageKey: contextLosses };
}
```

Nota: `RoomScreen` só renderiza no cliente (`'use client'` + dados do socket), mas o primeiro render ainda acontece no servidor. O inicializador de `useState` roda no SSR também: `document`/`window` não existem lá. Por isso a `RoomScreen` mostra "Entrando na sala…" até ter snapshot (já é assim), e **`useSceneMode` deve ser chamado num componente que só monta no cliente**. Para garantir, os inicializadores tratam ausência de `window`: trocar `useState(hasWebgl2)` por `useState(() => typeof document !== 'undefined' && hasWebgl2())`, e idem `prefersReducedMotion` com `typeof window !== 'undefined'` — `readPreferredMode`/`readQualityOverride` já toleram falha (try/catch). No SSR o resultado é `2d` (sem WebGL), e a `RoomScreen` só mostra o lobby depois do snapshot via socket (cliente), quando o estado já foi lido no cliente. Se a hidratação acusar diferença, mover a leitura para `useEffect` + estado `ready` e renderizar o palco só quando `ready`.

`src/features/game/use-celebration-delay.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';

export const CELEBRATION_MS = 1200;

/** Ao iniciar a partida no 3D, segura o lobby por um instante (confete) antes de trocar para a tela do jogo. */
export function useCelebrationDelay(inGame: boolean, enabled: boolean, delayMs = CELEBRATION_MS): boolean {
  const [showGame, setShowGame] = useState(inGame);
  const previous = useRef(inGame);

  useEffect(() => {
    const wasInGame = previous.current;
    previous.current = inGame;
    if (!inGame) {
      setShowGame(false);
      return;
    }
    if (wasInGame || !enabled) {
      setShowGame(true);
      return;
    }
    const timer = setTimeout(() => setShowGame(true), delayMs);
    return () => clearTimeout(timer);
  }, [inGame, enabled, delayMs]);

  return enabled ? showGame : inGame;
}
```

`src/features/game/scene-controls.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import type { DisplayMode } from './scene3d/display-mode';
import type { QualityOverride } from './scene3d/quality';

const QUALITY_LABELS: Record<QualityOverride, string> = { auto: 'Automática', high: 'Alta', medium: 'Média', low: 'Baixa' };

export function SceneControls({
  mode,
  quality,
  onModeChange,
  onQualityChange,
}: {
  mode: DisplayMode;
  quality: QualityOverride;
  onModeChange: (mode: DisplayMode) => void;
  onQualityChange: (quality: QualityOverride) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md items-center justify-end gap-2 px-4 pt-2 text-sm">
      {mode === '3d' && (
        <label className="flex items-center gap-1">
          <span className="sr-only">Qualidade 3D</span>
          <select
            aria-label="Qualidade 3D"
            className="border-input bg-background h-9 rounded-md border px-2"
            value={quality}
            onChange={(e) => onQualityChange(e.target.value as QualityOverride)}
          >
            {(Object.keys(QUALITY_LABELS) as QualityOverride[]).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABELS[q]}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button variant="outline" size="sm" className="h-9" onClick={() => onModeChange(mode === '3d' ? '2d' : '3d')}>
        {mode === '3d' ? 'Ver em 2D' : 'Ver em 3D'}
      </Button>
    </div>
  );
}
```

`src/features/game/scene3d/lobby-stage-lazy.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';

/** RNF-3D-01: three.js só é baixado aqui, dentro da sala. */
export const LobbyStageLazy = dynamic(() => import('./lobby-stage'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-violet-950 to-fuchsia-900 text-sm text-violet-100" aria-hidden="true">
      Montando o salão…
    </div>
  ),
});
```

`src/features/game/room-screen.tsx` — mudanças (preservar o final de linha do arquivo):
- imports:

```tsx
import { SceneControls } from './scene-controls';
import { LobbyStageLazy } from './scene3d/lobby-stage-lazy';
import { useCelebrationDelay } from './use-celebration-delay';
import { useSceneMode } from './use-scene-mode';
```

- depois de `useWakeLock(snapshot?.status === 'IN_GAME');` acrescentar:

```tsx
  const scene = useSceneMode();
  const inGame = snapshot?.status === 'IN_GAME' || showResult;
  const showGame = useCelebrationDelay(inGame, scene.mode === '3d');
  useEffect(() => {
    if (scene.reason === 'context-lost') toast('Modo 2D ativado para economizar o aparelho');
  }, [scene.reason]);
```

- substituir a linha que escolhe entre `GameView` e `LobbyView` por:

```tsx
      {showGame ? (
        <GameView actions={actions} />
      ) : (
        <>
          {scene.mode === '3d' && (
            <div className="h-[40dvh] w-full landscape:h-[55dvh]">
              <LobbyStageLazy
                key={scene.stageKey}
                roomName={snapshot.name}
                code={snapshot.code}
                celebrating={inGame}
                qualityOverride={scene.quality}
                onContextLost={scene.reportContextLoss}
              />
            </div>
          )}
          <SceneControls mode={scene.mode} quality={scene.quality} onModeChange={scene.setPreferred} onQualityChange={scene.setQuality} />
          <LobbyView actions={actions} onLeave={() => void leave()} />
        </>
      )}
```

(`ResultDialog` continua como está, logo abaixo.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/features/game`
Expected: PASS (testes novos + todos os antigos da `RoomScreen`).

- [ ] **Step 5: Verificação real no navegador**

Run: `npm run build && npx next start -p 3100` (back rodando localmente para entrar numa sala) — ou `npm run dev` para iterar.
Manual: entrar numa sala; ver o salão no topo e a HUD embaixo; abrir `http://localhost:3000/ABC234?bots=25` em dev e conferir os 24 bots entrando pela porta; tocar no próprio boneco (dança); "Ver em 2D" esconde o canvas e persiste após recarregar; DevTools → "Rendering → Emulate prefers-reduced-motion: reduce" abre em 2D. Se algo visual estiver claramente errado (bonecos atravessando o chão, câmera cortando a plateia), ajustar **constantes** de composição (offsets em `avatar-crowd.tsx`, `TARGET`/`HALF_*` em `camera.ts` respeitando o teste) e anotar no commit.

- [ ] **Step 6: Lint, typecheck, suíte e commit**

Run: `npm run lint && npm run typecheck && npm run test:cov`
Expected: verde, cobertura ≥ 80%.

```bash
git add src/features/game
git commit -m "feat(game): 3D lobby stage with 2D fallback, scene controls, context-loss recovery and start confetti

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Garantia de bundle, CI, documentação e fechamento do marco

**Files:**
- Create: `scripts/check-bundle.mjs`
- Modify: `package.json` (script `check:bundle`), `.github/workflows/ci.yml`, `README.md`, `docs/superpowers/plans/2026-10-05-roadmap.md` (+ cópia idêntica em `go-bingo-back/docs/superpowers/plans/`)

**Interfaces:**
- Consumes: saída de `npm run build` (`.next/`).
- Produces: `npm run check:bundle` — falha se alguma página fora da sala carrega three.js.

- [ ] **Step 1: Escrever o verificador**

`scripts/check-bundle.mjs`:

```js
// RNF-3D-01: Home, login, criar e ranking não podem baixar three.js.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const NEXT = '.next';
const PAGES = ['index', 'criar', 'ranking'];
const MARKERS = ['WebGLRenderer', 'THREE.WebGLRenderer', '@react-three/fiber'];

function htmlFor(page) {
  const file = join(NEXT, 'server', 'app', `${page}.html`);
  if (!existsSync(file)) throw new Error(`Página estática não encontrada: ${file}. Rode "npm run build" antes.`);
  return readFileSync(file, 'utf8');
}

function scriptsIn(html) {
  return [...html.matchAll(/<script[^>]+src="\/_next\/([^"]+\.js)"/g)].map((m) => join(NEXT, m[1]));
}

let failed = false;
for (const page of PAGES) {
  const scripts = scriptsIn(htmlFor(page));
  if (scripts.length === 0) throw new Error(`Nenhum <script> encontrado em ${page}.html — o formato do build mudou; ajuste o verificador.`);
  for (const script of scripts) {
    const code = readFileSync(script, 'utf8');
    const hit = MARKERS.find((marker) => code.includes(marker));
    if (hit) {
      console.error(`✖ /${page === 'index' ? '' : page} carrega three.js (${hit}) via ${script}`);
      failed = true;
    }
  }
  console.log(`✔ /${page === 'index' ? '' : page}: ${scripts.length} scripts sem three.js`);
}
if (failed) process.exit(1);

// Sanidade: o three.js tem que existir em algum chunk (senão o teste acima não prova nada).
const chunks = readdirSync(join(NEXT, 'static', 'chunks'), { recursive: true }).filter((f) => String(f).endsWith('.js'));
const withThree = chunks.filter((f) => readFileSync(join(NEXT, 'static', 'chunks', String(f)), 'utf8').includes('WebGLRenderer'));
if (withThree.length === 0) {
  console.error('✖ Nenhum chunk contém three.js — o marcador mudou; ajuste MARKERS.');
  process.exit(1);
}
console.log(`✔ three.js isolado em ${withThree.length} chunk(s) da sala`);
```

`package.json` — em `scripts`, acrescentar `"check:bundle": "node scripts/check-bundle.mjs"`.

- [ ] **Step 2: Rodar contra o build real**

Run: `npm run build && npm run check:bundle`
Expected: `✔` para `/`, `/criar`, `/ranking` e "three.js isolado em N chunk(s)". Se o caminho do HTML estático for outro no Next 16 (ex.: `.next/server/app/index.html` vs `.next/server/app/index/...`), localizar com `ls .next/server/app` e ajustar `htmlFor` — o objetivo (nenhum script dessas páginas contém three) não muda. Para provar que o verificador pega o erro: importar temporariamente `three` em `src/app/(app)/page.tsx`, rebuildar, ver `✖`, e **reverter**.

- [ ] **Step 3: CI**

`.github/workflows/ci.yml` — depois de `- run: npm run build`, acrescentar:

```yaml
      - run: npm run check:bundle
```

- [ ] **Step 4: Documentar**

`README.md` — acrescentar ao final da seção "Rodando o Go Bingo Front", depois da seção "PWA (M2)" (preservar o final de linha):

````markdown
### Lobby 3D (M3)

- A cena fica em `src/features/game/scene3d/`: regras puras (`choreographer.ts`, `pose.ts`, `quality.ts`...) testadas no Vitest; componentes R3F (`*.tsx`) só desenham.
- three.js só é baixado dentro da sala (`npm run check:bundle` garante no CI).
- Modo 2D automático sem WebGL2, com `prefers-reduced-motion` ou após 2 perdas de contexto; botão "Ver em 2D/3D" e seletor de qualidade no lobby.
- Teste de carga: em dev, `/{codigo}?bots=25` coloca 24 bonecos falsos só na cena (em produção, apenas com `NEXT_PUBLIC_ENABLE_BOTS=1`).

**Checklist de aparelho real (critério de saída do M3):**

- [ ] Android intermediário, `?bots=25` (build com `NEXT_PUBLIC_ENABLE_BOTS=1`): ≥ 30 FPS (Chrome DevTools remoto → Performance/FPS meter) no tier automático.
- [ ] iPhone: trocar de app várias vezes durante o lobby; a cena volta ou cai para 2D com aviso, sem sair da sala.
- [ ] `prefers-reduced-motion` ligado no sistema → sala abre em 2D; "Ver em 3D" funciona e é lembrado.
- [ ] Entrar/sair/cair com um segundo aparelho: boneco entra pela porta, acena ao sair, fica pálido flutuando ao cair e volta ao reconectar.
- [ ] Tocar no próprio boneco: dança; tocar no de outra pessoa: nada.
- [ ] Host inicia: confete por ~1 s e troca para a tela da partida.
````

`docs/superpowers/plans/2026-10-05-roadmap.md` (nos dois repos, idênticos) — linha 4 (M3): trocar a coluna Plano por `[2026-10-07-front-m3-lobby-3d.md](2026-10-07-front-m3-lobby-3d.md)` e Status por `Implementado na branch \`feat/front-m3-lobby-3d\` (falta checklist em aparelho real — README do front)`; e copiar este plano e o spec (`docs/superpowers/specs/2026-10-07-m3-lobby-3d-design.md`) para o back nos mesmos caminhos.

- [ ] **Step 5: Verificação final do marco**

Run: `npm run lint && npm run typecheck && npm run test:cov && npm run build && npm run check:bundle`
Expected: tudo verde.

- [ ] **Step 6: Commit (front) e commit (back)**

```bash
git add scripts/check-bundle.mjs package.json .github/workflows/ci.yml README.md docs
git commit -m "chore(scene3d): bundle guard for three.js, CI step and M3 docs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
cd ../go-bingo-back && git add docs && git commit -m "docs(plan): M3 lobby 3D plan, spec and roadmap status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && cd ../go-bingo-front
```

---

## Self-Review

- **Cobertura do spec:** D1 arte procedural → Task 7 (geometrias primitivas). D2 coreógrafo + instancing → Tasks 3, 5, 7. D3 nada por frame na store → Task 5 (`statesRef`, `list` só em mudança; teste `without re-rendering every frame`). D4 pose pura → Task 2. D5 avatar do id → Task 1. D6 sem detect-gpu → Task 4 (`pickInitialTier`). D7 extras: reação de presença (olhar a porta, coroa do host, pulo de pronto) → Task 3; toque/dança + arrasto ±15° → Tasks 3, 5, 6, 7; ambiente vivo (lâmpadas, globo pulsante, confete) → Tasks 3, 6, 7, 8. §6 modo/qualidade/contexto → Tasks 4, 6, 8. §7 lazy + verificação de bundle → Tasks 8, 9. §8 bots → Tasks 4, 5, 7. §9 testes → em cada task. Rótulos com regra de 15 → Tasks 3, 7.
- **Placeholders:** nenhum "TBD"; trechos "se X divergir, ajustar Y" dizem exatamente o que pode mudar (constantes de composição, caminho do HTML do build) e o que não pode (o objetivo testado).
- **Consistência de tipos:** `AvatarState` (Task 2) tem `hasCard`/`connected`/`lookAtDoorUntil` usados pelo coreógrafo (Task 3); `SceneMember` (Task 3) usado por `botMembers` (Task 4) e pelo hook (Task 5, via `snapshot.members`, que tem os mesmos campos + extras); `useAvatarStates` retorna `{ statesRef, list, dance }` consumido em Task 7; `LobbyStageProps` (Task 6: `roomName, code, celebrating, qualityOverride, onContextLost`) é o que a Task 8 passa; `useSceneMode` retorna `stageKey` usado como `key`.
- **Review Focus → testes:** 1 → Task 3 (`does not restart`, `reconnection goes idle`); 2 → Task 3 (`first snapshot`); 3 → Tasks 4 (`pickDisplayMode` 7 casos) e 8 (`useSceneMode`, toast na RoomScreen); 4 → Tasks 3 (`ignores taps on someone else`) e 5 (`dance works only on my own avatar`); 5 → Task 4 (`scene-prefs … storage is blocked`).
