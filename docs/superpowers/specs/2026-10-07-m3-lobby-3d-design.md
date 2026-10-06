# M3 — Lobby 3D (design)

> Spec do marco M3 do [PRD](../../PRD.md) (§6.1). Aprovado em conversa em 2026-10-07; decisões abertas foram delegadas ao agente pelo autor.
> Repo: `go-bingo-front` apenas. Nenhuma mudança no back nem no contrato.

## 1. Objetivo e critério de saída

Na sala de espera, cada jogador aparece como um **boneco 3D low-poly** num salão de game show: entra andando pela porta, pula quando fica pronto, vira fantasma ao cair, acena ao sair. O 3D é palco; a HUD do lobby (DOM, já existente) continua sendo a interface.

**Critério de saída (PRD §6.1):** ≥ 30 FPS no celular de referência (Android intermediário) com 25 avatares; sem regressão no modo 2D; Home/login/ranking não baixam three.js.

**Fora do escopo (M4):** globo girando, telão de números, painel 1–75, destaque "por 1", cena de vitória, sons. A tela da **partida** continua 2D. Customização de avatar (P1) e emotes (P1) também ficam fora.

## 2. Decisões

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Arte procedural** (primitivas do three), sem glTF | Zero KB de modelos, sem pipeline Draco/KTX2, identidade própria "brinquedo de vinil", instancing trivial. Resolve Q3 do PRD para o M3. |
| D2 | **Abordagem A: coreógrafo puro + `InstancedMesh` por peça** | ~10 draw calls para 25 bonecos (RNF-3D-03); lógica testável sem WebGL. |
| D3 | Estado **por frame nunca vai para a store** | A store guarda fase + instante de início; `useFrame` calcula a pose e escreve direto nas matrizes. Evita re-render a 60 Hz. |
| D4 | **Pose = função pura de `(fase, t, seed)`**, não `lerp` incremental | Testável, determinística (todos veem igual), independente do FPS. |
| D5 | Avatar **derivado do `userId`** (hash) | PRD E2 P0; nada a guardar no back. |
| D6 | **Sem `detect-gpu`** | Ele busca benchmarks numa CDN; usamos sinais locais + `PerformanceMonitor`. |
| D7 | Extras aprovados: reações de presença, toque no avatar, ambiente vivo | Pedido do autor ("seja criativo"); todos só no front. |

## 3. Arquitetura

```
useGameStore (já existe: snapshot, eventos do socket)
   │  (assinatura fora do React)
   ▼
choreographer (puro) ── AvatarState[] { userId, slot, look, phase, phaseStart, isHost, lookAtDoorUntil }
   │
   ▼
<RoomScreen> ── modo 3D? ──► <LobbyStage/> (next/dynamic, ssr:false)  +  <LobbyView/> (HUD DOM)
            └── modo 2D ───►                                             <LobbyView/> (como hoje)

<LobbyStage>
  <Canvas dpr frameloop aria-hidden>
    <QualityController/>        PerformanceMonitor → tier/DPR
    <Hall/>                     chão, palco, telão (nome+código), globo parado, porta, lâmpadas instanciadas
    <AvatarCrowd/>              1 InstancedMesh por peça; useFrame → pose() → setMatrixAt/setColorAt
    <NameLabels/>               drei <Text> billboard (regra de visibilidade)
    <Confetti/>                 InstancedMesh, ao iniciar a partida
    <CameraRig/>                enquadramento por aspect + arrasto ±15°
```

### Unidades (cada uma com uma responsabilidade)

| Unidade | Tipo | Faz |
|---|---|---|
| `scene3d/avatar-look.ts` | puro | `avatarFromId(id) → { body, accent, hat, face, seed }` (FNV-1a sobre o uuid). 8 cores de corpo, 6 de acessório, chapéus `none\|tophat\|cap\|beanie\|party`, faces `smile\|grin\|wow`. |
| `scene3d/slots.ts` | puro | `slotPosition(slot) → [x,y,z]` para 25 lugares em 3 fileiras em arco (8/8/9) de frente para o palco; `DOOR` e `FRONT` constantes. |
| `scene3d/choreographer.ts` | puro | `choreograph(prev, snapshot, now, events) → Map<userId, AvatarState>`; regras da §4. |
| `scene3d/pose.ts` | puro | `pose(state, now) → { position, rotationY, headYaw, scale, opacity, armWave }`. |
| `scene3d/display-mode.ts` | puro | `pickDisplayMode(signals) → '3d' \| '2d'` + motivo. |
| `scene3d/quality.ts` | puro | `pickInitialTier(signals)`, `TIER_SETTINGS`, `nextTier(current, 'up'\|'down', history)`. |
| `scene3d/scene-prefs.ts` | DOM | lê/grava preferência 2D/3D e qualidade em `localStorage` (try/catch). |
| `scene3d/use-avatar-states.ts` | hook | assina a store, roda o coreógrafo, mantém `Map` em ref; expõe versão para re-render só quando o conjunto/fase muda. |
| `scene3d/lobby-stage.tsx` | R3F | Canvas + composição; único ponto de entrada lazy. |
| `scene3d/*.tsx` (hall, avatar-crowd, name-labels, confetti, camera-rig, quality-controller) | R3F | renderização; sem regra de negócio. |
| `game/room-screen.tsx` | DOM | decide modo, monta `LobbyStage` lazy acima da `LobbyView`, toggle 3D/2D, aviso de perda de contexto. |

## 4. Fases, poses e reações

| Fase | Gatilho (derivado da store) | Duração | Pose |
|---|---|---|---|
| `idle` | padrão; primeiro snapshot ao entrar na sala | ∞ | respiração (escala ±2%), balanço de cabeça defasado por `seed` |
| `entering` | membro novo num snapshot posterior ao primeiro e não é reconexão | 1,8 s | anda saltitando de `DOOR` até o slot (easing), olhando para a frente no fim |
| `ready-jump` | `hasCard` passou de `false` para `true` | 0,6 s | pulo (parábola, altura 0,6) |
| `ghost` | `connected:false` | até reconectar/sair | cor pálida lavanda (`#c4b5fd`), flutua ±0,08, levemente menor |
| `leaving` | membro sumiu do snapshot | 2,2 s | acena 0,8 s no lugar, anda até `DOOR`, encolhe; removido ao fim |
| `dance` | toque local no próprio avatar | 1,5 s | gira 2 voltas e pula 2× |

Regras do coreógrafo:
- Fase de animação temporária (`entering`, `ready-jump`, `dance`) volta a `idle` (ou `ghost` se desconectado) quando `now - phaseStart ≥ duração`.
- Mesmo estado repetido (evento duplicado após reconexão) **não reinicia** a fase.
- Reconexão (`connected` volta a `true`) → `idle` sem `entering`.
- `isHost` acompanha `snapshot.hostId` → coroa dourada (substitui o chapéu).
- **Reação de presença:** quando alguém entra, os demais em `idle` viram a cabeça para `DOOR` por 1 s (`lookAt` com `until`).
- `dance` só pode ser disparado pelo próprio usuário e só sobre o próprio avatar.
- Ao trocar para `IN_GAME`, emite `celebrate` (confete) uma vez; a `RoomScreen` troca para a `GameView` após 1,2 s (ou na hora no modo 2D/qualidade baixa).

Rótulos de apelido: `<Text>` do drei acima da cabeça, sempre texto. Visíveis: todos se ≤ 15 membros (ou tier Alto); senão só o meu, o do host e de quem está em `entering`. A lista completa segue na HUD.

## 5. Visual

- Paleta saturada sobre fundo roxo profundo (`#4c1d95`, tema do app); chão de tábuas (cor sólida + faixas), palco semicircular, telão com nome da sala e código em fonte grande.
- Lâmpadas de game show: `InstancedMesh` de esferas emissivas em volta do palco, piscando em onda (tier ≥ Médio).
- Globo parado com brilho pulsante (emissive). Porta com moldura à esquerda.
- Boneco: cápsula (corpo) + esfera (cabeça) + 2 olhos + boca (meia-esfera achatada) + braços cápsula + chapéu; ~0,9 de altura.
- Câmera: retrato → mais alta e próxima, enquadra palco + primeiras fileiras; paisagem/desktop → mais aberta, plateia inteira. Arrasto horizontal gira até ±15° e volta com mola. Sem orbit livre.

## 6. Modo de exibição, qualidade e robustez

`pickDisplayMode`: sem WebGL2 → 2D; `prefers-reduced-motion` → 2D; preferência manual 2D → 2D; ≥ 2 perdas de contexto na sessão → 2D (aviso "Modo 2D ativado para economizar o aparelho"); senão 3D. Toggle discreto "3D/2D" na HUD do lobby.

| | Alto | Médio | Baixo |
|---|---|---|---|
| DPR máx | 2 | 1,5 | 1 |
| Sombras | dos bonecos | disco falso no chão | não |
| Lâmpadas | piscando | piscando | estáticas |
| Confete | 300 | 120 | 0 |
| Antialias | sim | sim | não |

- Tier inicial: `cores ≥ 8 && memoryGb ≥ 6` (memória desconhecida conta como 8) → Alto; `cores ≤ 4 || memoryGb ≤ 3` → Baixo; senão Médio. Telas pequenas (< 400 px de largura) limitam a Médio.
- `PerformanceMonitor`: `onDecline` → reduz DPR em 0,25 até o mínimo do tier, depois desce um tier; `onIncline` sobe no máximo uma vez por sessão; `flipflops={3}` → `onFallback` fixa o tier atual.
- Override manual "Qualidade: Auto/Alta/Média/Baixa" (persistido).
- Aba oculta → `frameloop="never"`. (Sem `demand`: os bonecos sempre respiram, então a cena nunca fica ociosa.)
- Perda de contexto WebGL: 1ª → remonta o Canvas (nova `key`); 2ª → modo 2D. Estado do jogo está na store; nada se perde.
- Canvas `aria-hidden`, `role="presentation"`; nenhuma informação só no 3D.

## 7. Carregamento

- `LobbyStage` via `next/dynamic(() => import(...), { ssr: false, loading })`; o esqueleto mostra o palco em CSS (gradiente) com "Montando o salão…".
- `three`, `@react-three/fiber`, `@react-three/drei` só entram no chunk da sala. Verificação no build: nenhum chunk referenciado por `/`, `/login`, `/ranking`, `/criar` contém `three`.
- Fonte do `<Text>`: a padrão do troika (sem baixar fonte extra).
- Cache do SW (M2) já cobre `/_next/static/**`.

## 8. Modo dev de carga

`?bots=N` (só quando `NODE_ENV !== 'production'` **ou** a flag `NEXT_PUBLIC_ENABLE_BOTS=1`): injeta N−1 membros falsos **apenas no estado da cena** (não na store/HUD, não no servidor), entrando escalonados a cada 150 ms, para medir FPS com 25 bonecos.

## 9. Testes

Vitest (jsdom, sem WebGL): `avatarFromId` (determinismo, domínio, distribuição), `slotPosition` (25 únicos, sem sobreposição < 0,9 m, dentro da caixa da câmera), `choreograph` (todas as regras da §4), `pose` (início/fim de cada fase, `entering` termina no slot, sem NaN, opacidade do fantasma), `pickDisplayMode`, `pickInitialTier`, `nextTier`, `scene-prefs` (storage bloqueado), `parseBots`. `RoomScreen` com `LobbyStage` mockado: 2D renderiza só a HUD; 3D renderiza palco + HUD; toggle; aviso de contexto perdido. Componentes R3F ficam fora da cobertura (wiring de renderização, justificado), como `src/app/sw.ts` no M2.

Manual (aparelho real): checklist no README (FPS com `?bots=25`, perda de contexto no iPhone, reduced-motion → 2D, toque no avatar, confete ao iniciar).

## 10. Riscos

| Risco | Mitigação |
|---|---|
| `<Text>` (troika) custa 1 draw call + SDF por rótulo | Regra de visibilidade (> 15 → só 3 rótulos); tier Baixo idem. |
| `setColorAt` não tem opacidade por instância | Fantasma = cor pálida + flutuação (sem transparência), mantendo 1 mesh por peça. |
| Picking em `InstancedMesh` | `e.instanceId` → índice → `userId` via tabela mantida pelo `AvatarCrowd`. |
| Jest-dom sem WebGL | Lógica 100% em módulos puros; R3F mockado nos testes de tela. |
