# M4 — Partida 3D (design)

> Spec do marco M4 do [PRD](../../PRD.md) (§6.1, E4, §4.2). Decisões tomadas pelo agente por delegação do autor (2026-10-07). Base: M3 ([spec](2026-10-07-m3-lobby-3d-design.md)).
> Repo: `go-bingo-front` apenas. **Sem mudança no back nem no contrato** — tudo é derivável da store existente (`snapshot.game.drawn`, `snapshot.game.remaining`, `winner`, `endedWithoutWinner`).

## 1. Objetivo e critério de saída

Durante a partida, a região de palco da tela de jogo (hoje "últimos números" em DOM) vira uma cena 3D: **globo girando que solta a bola sorteada**, **telão** com bola atual + 4 anteriores + painel 1–75 aceso, **plateia** com os bonecos do M3, **destaque "por 1"** (boneco dourado pulsando e saltitando) e **cena de vitória** (câmera vai até o vencedor, que pula e gira; telão "BINGO! — Fulano"; confete). Sons sintetizados com mudo persistente. Cartela, BINGO! e pedras continuam na HUD DOM.

**Critério de saída (PRD):** metas de FPS do M3 mantidas na partida; número visível na HUD imediatamente (a animação é cosmética e nunca atrasa a HUD); zero regressão no modo 2D.

**Fora do escopo:** narração sintetizada "B 7" (P1), cartela 3D na mesa (P1), emotes (P1), pódio 3D (P1).

## 2. Decisões

| # | Decisão | Motivo |
|---|---|---|
| G1 | **Canvas próprio da partida** (`GameStage`), separado do lobby; config comum extraída para `StageCanvas` | Manter um Canvas único entre lobby e partida exigiria unificar o layout das duas telas. A troca custa um contexto WebGL novo, e o anterior é descartado pelo R3F. |
| G2 | **Telão = `CanvasTexture`** desenhada por função pura `drawTelao(ctx, view)` | 1 draw call para bola atual + 4 anteriores + 75 números; texto nítido; testável com contexto falso. Substitui os `<Text>` do telão do lobby (o lobby passa a usar a mesma textura). |
| G3 | Número na HUD **imediato**; bola 3D é cosmética (voa ≤ 1,6 s, some aos 3,5 s; intervalo é 5 s) | PRD US-4.1. A `LastNumbers` DOM continua presente (visível no 2D; `sr-only` com `aria-live` no 3D). |
| G4 | "Por 1" e vitória como **extensões do coreógrafo** (`oneAway` por avatar, fase `winner`) e da `pose` (`glow`) | Mesma arquitetura testável do M3. |
| G5 | **Câmera com alvo por modo** (`lobby`/`game`) + **foco no vencedor** e aproximação exponencial pura (`approach`) | Transições suaves e testáveis. |
| G6 | **Sons WebAudio sintetizados** (sem arquivos), decididos por função pura `sfxFor(prev, next, me)`; mudo em `localStorage` | Zero assets; primeiro snapshot (entrar/recarregar) é silencioso; funciona no 2D também. |
| G7 | **Painel 1–75 na HUD** sob demanda ("Painel") e botão de som, sobre a região do palco | PRD §4.3 (< 360 px) e acessibilidade; vale nos dois modos. |
| G8 | No 3D, o diálogo de resultado aparece **2,5 s depois** da vitória | Dá tempo de ver a cena; no 2D é imediato. |

## 3. Unidades novas/alteradas

| Unidade | Tipo | Faz |
|---|---|---|
| `scene3d/telao.ts` | puro | `TelaoView` (lobby/game/won/ended), `telaoView(input)`, `drawTelao(ctx, view)`, `TELAO_W/H`. |
| `scene3d/globe.ts` | puro | `GLOBE_CENTER`, `BALL_REST`, `BALL_FLIGHT_MS`, `BALL_SHOW_MS`, `ballFlight(ms)`, `globeSpin(now, lastDrawAt)`, `innerBall(i, now)`. |
| `scene3d/camera.ts` | puro (alterado) | `cameraFor(aspect, view)`, `focusOn(slot)`, `approach(cur, target, dt, rate)`. |
| `scene3d/choreographer.ts`, `pose.ts` | puro (alterado) | `oneAway`, fase `winner`, `glow`; `labelIds` mostra sempre "por 1" e vencedor. |
| `scene3d/use-avatar-states.ts` | hook (alterado) | lê `remaining` (=1 → por 1) e `winner` da store. |
| `sound/sfx.ts`, `sound/sfx-player.ts`, `sound/use-game-sounds.ts`, `sound/use-muted.ts` | puro/hook | notas por efeito, decisão de efeitos, player WebAudio, mudo persistido. |
| `drawn-board.tsx`, `sound-toggle.tsx` | DOM | painel 1–75 em diálogo; botão de som. |
| `scene3d/stage-canvas.tsx`, `telao.tsx`, `globe.tsx`, `game-stage.tsx`, `game-stage-lazy.tsx` | R3F | Canvas comum; telão; globo + bola; cena da partida; lazy. |
| `game-view.tsx`, `room-screen.tsx` | DOM (alterado) | `stage` opcional na região do palco; sons; atraso do resultado no 3D. |

## 4. Comportamento

- **Sorteio:** ao chegar `game:number_drawn`, a HUD já mostra o número (store). Na cena: o globo acelera (decai em ~0,6 s), a bola sai do globo, faz um arco até a frente do palco, flutua e some aos 3,5 s; o telão atualiza na hora.
- **Por 1:** quem tem `remaining === 1` fica dourado pulsando e dá pulinhos enquanto parado; rótulo do apelido sempre visível. Som "por 1" quando alguém novo entra nesse estado.
- **Vitória:** fase `winner` (pula e gira com brilho máximo) até o próximo `room:state`; câmera aproxima do vencedor; telão "BINGO!" + apelido ("Você!" se for eu); confete; som fanfarra (eu) ou acorde (outro). Diálogo de resultado após 2,5 s.
- **Fim sem vencedor:** telão "Fim de jogo"; som descendente.
- **Reconectar/recarregar:** primeiro snapshot não toca som nem anima bola (bola só anima quando `drawCount` aumenta com a cena montada).
- **Modo 2D:** igual ao M1 (LastNumbers visível), mais os botões "Painel" e som.

## 5. Testes

Vitest: `drawTelao` (fake ctx: código no lobby, número atual, 4 anteriores, exatamente N células acesas, vitória com apelido, fim), `telaoView` (prioridades), `ballFlight`/`globeSpin`/`innerBall`, câmera (`game` enquadra telão/globo/bola; `focusOn` centraliza; `approach` converge sem ultrapassar), coreógrafo (`oneAway`, `winner` entra/sai, rótulos), `pose` (`glow`, vencedor), `sfxFor`, player com AudioContext falso, `useGameSounds`, `useMuted`, `DrawnBoard`, `SoundToggle`, `GameView` com `stage`, `RoomScreen` (palco 3D da partida, atraso do resultado no 3D, imediato no 2D). R3F `.tsx` fora da cobertura (como no M3).

Manual (README): FPS na partida com `?bots=25`, bola/telão sincronizados, "por 1" e vitória vistos de dois aparelhos, mudo persistente, 2D sem regressão.
