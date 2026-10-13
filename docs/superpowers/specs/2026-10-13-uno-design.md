# UNO — design

Data: 2026-10-13. Autor: Claude (decisões delegadas pelo Gustavo, que estava ausente).

## Objetivo

Terceiro jogo da plataforma DedéGames: UNO multiplayer em tempo real, 2 a 6 humanos,
mesas públicas e privadas, no mesmo servidor NestJS e no mesmo molde do Truco
(namespace Socket.IO próprio, estado em memória, servidor autoritativo, contratos Zod
sincronizados para o front).

Sucesso = uma mesa de 2 a 6 pessoas joga uma partida completa no celular, com
reconexão, sem nenhum jogador ver cartas alheias, e a experiência lembra os prints de
referência (fundo vermelho/laranja vibrante, oponentes em arco, monte + descarte no
centro, seta de sentido, botão grande de UNO, Desafiar/Recusar no +4).

## Decisões (tomadas sem consulta; corrigíveis)

| Tema | Decisão |
|---|---|
| Jogadores | 2 a 6 por mesa. O anfitrião inicia com ≥ 2 sentados, conectados e prontos. |
| Bots | Nenhum (igual Truco). |
| Baralho | Oficial: 108 cartas (0 ×1 e 1–9 ×2 por cor, Pular/Inverter/+2 ×2 por cor, 4 Coringas, 4 +4). 7 cartas por jogador. |
| Primeira carta | Coringa ou +4 viram de volta para o monte e outra é virada. Pular: o primeiro perde a vez. Inverter: o sentido inverte (com 2 jogadores vale como Pular). +2: o primeiro compra 2 e perde a vez. |
| Comprar | Na sua vez você pode comprar 1 mesmo tendo carta jogável (regra oficial). Se a comprada servir, você escolhe jogá-la ou passar; se não servir, a vez passa sozinha. |
| +4 | Pode ser jogado sempre (blefe permitido). O próximo pode **Desafiar**: se quem jogou tinha carta da cor atual, ele compra 4 e o desafiante não compra nada (e joga normalmente); senão o desafiante compra 6 e perde a vez. **Recusar** = comprar 4 e perder a vez. |
| UNO! | Botão "UNO!" disponível com 2 cartas na sua vez ou com 1 carta ainda não anunciada. Quem fica com 1 carta sem ter gritado fica **exposto** (público) até a próxima ação de outro jogador; qualquer outro jogador pode apertar **"Pegou!"** e o exposto compra 2. |
| Inverter com 2 | Funciona como Pular. |
| Fim da rodada | Quem descarta a última carta vence a rodada. Se a última carta for +2/+4, o próximo ainda compra (conta nos pontos). |
| Pontuação | Oficial: o vencedor da rodada soma as cartas dos outros (número = valor; Pular/Inverter/+2 = 20; Coringa/+4 = 50). |
| Modos (anfitrião escolhe no lobby) | **Rodada única** (padrão, partida rápida), **Corrida dos 200** ou **Corrida dos 500**. |
| Regras da casa (opcionais, anfitrião liga no lobby) | **Empilhar** (+2 sobre +2; +4 sobre +2 ou +4; a vítima soma e passa adiante ou compra tudo) e **7-0** (7 troca de mão com quem você escolher; 0 gira todas as mãos no sentido do jogo). Desligadas por padrão. |
| Tempo por jogada | 25 s (`UNO_TURN_MS`). Estourou: com compra pendente compra tudo; com carta comprada mantém; senão compra 1 e passa. Contador visível para todos. |
| Desconexão | Lugar reservado por `UNO_RECONNECT_GRACE_MS` (60 s). Durante a partida as vezes do ausente rodam no tempo (auto-compra). Prazo vencido ou "Sair" durante a partida: o jogador sai, as cartas dele voltam ao fundo do monte e a partida segue; sobrando 1 jogador, ele vence por abandono. |
| Reações | Emotes rápidos (😂 😱 😡 👏 🔥 🙏) visíveis para a mesa, 1 por segundo por socket. Sem sinais secretos (UNO não tem duplas). |
| Ranking/moedas | Fora do escopo (igual Truco). |
| Nome | "UNO" na interface; o verso da carta tem "UNO" num oval vermelho, cartas desenhadas em CSS (sem imagens). |

## Arquitetura (espelha o Truco)

```
front (Next)                         back (NestJS)
features/uno ──socket.io /uno──▶     UnoGateway         auth JWT, Zod, rate limit, dedupe por actionId
  store (zustand, version/seq)         │
  reactions (grito, som, voz)          ▼
                                     UnoRoomsService    autoridade: salas, lugares, presença, timers (vez, pausa, reconexão)
                                       │
                                       ▼
                                     UnoMatch (engine)  regras puras: rodadas, efeitos, desafio, UNO, pontuação
```

### Back (`go-bingo-back`)

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/uno.ts` | Tipos, constantes, schemas Zod e nomes de eventos. Exportado em `contracts/index.ts`. |
| `src/uno/engine/deck.ts` | Baralho de 108, pontos por carta, `canPlayOn`. Embaralha com `shuffle` do truco (crypto). |
| `src/uno/engine/match.ts` | `UnoMatch`: rodadas, vez/sentido, efeitos, compra, desafio do +4, UNO/pegou, empilhar, 7-0, timeout, saída de jogador, pontuação e fim da partida. Sem tempo nem transporte. Cada método valida, lança `DomainError` e devolve `Announcement[]`. Tem `turnToken` que muda a cada vez (o serviço usa para agendar o timer). |
| `src/uno/uno-rooms.service.ts` | Salas em memória (6 lugares), prontidão, regras da mesa, início (≥ 2), timers de vez/pausa entre rodadas/reconexão, anfitrião, lista pública, publicação. |
| `src/uno/uno.gateway.ts` | Namespace `/uno`: handshake JWT + perfil, Zod, rate limit (10/s, criar 3/10 s, emote 1/s), dedupe por `actionId` (reusa `ActionDeduper`). |
| `src/uno/uno-publisher.ts` | `room:CODE`, `user:ID`, lista pública com debounce de 300 ms. |
| `src/uno/uno.module.ts` | Wiring; registrado no `AppModule`. |
| `src/core/env.ts` | `UNO_RECONNECT_GRACE_MS` (60000), `UNO_TURN_MS` (25000), `UNO_ROUND_PAUSE_MS` (4000), `UNO_MAX_ROOMS` (1000). |
| `docs/uno.md` | Documentação no formato de `docs/truco.md`. |

### Estado público vs privado

- `UnoRoomState` (todos): código, versão, anfitrião, pública?, regras, fase (`LOBBY`/`PLAYING`/`FINISHED`), lugares (6, com contagem de cartas), placar por lugar, visão da rodada (carta do topo, cor atual, sentido, vez, prazo da vez, compra pendente, pode desafiar, exposto no UNO, quem gritou UNO, tamanho do monte) e resultado.
- `UnoPrivateHand` (só o dono, via `user:ID`): número da rodada, cartas `{ id, card }`, ids jogáveis agora (calculados no servidor) e id da carta recém-comprada.
- Ids de carta são sequenciais atribuídos **depois** do embaralhamento e únicos por rodada: não revelam a carta.

### Eventos (`/uno`)

Cliente → servidor (ack `{ ok, data } | { ok:false, error }`): `uno:create {isPublic}`,
`uno:watch_rooms`, `uno:unwatch_rooms`, `uno:set_visibility {isPublic}`,
`uno:set_rules {rules}`, `uno:join {code}`, `uno:sync`, `uno:leave`, `uno:ready {ready}`,
`uno:start`, `uno:rematch`, e ações com `actionId`: `uno:play_card {cardId, color?, target?}`,
`uno:draw`, `uno:pass`, `uno:challenge`, `uno:call_uno`, `uno:catch_uno`; mais `uno:emote {emote}`.

Servidor → cliente: `uno:state`, `uno:private_hand`, `uno:rooms_updated`, `uno:room_closed`,
`uno:emoted` (sem seq) e anúncios com `seq`: `player_joined`, `player_left`,
`player_disconnected`, `player_reconnected`, `match_started`, `round_started`,
`card_played`, `cards_drawn`, `turn_skipped`, `direction_changed`, `hands_swapped`,
`hands_rotated`, `challenge_resolved`, `uno_called`, `uno_caught`, `turn_timed_out`,
`round_ended`, `match_over`.

### Front (`go-bingo-front`)

- Rotas `/uno` (lobby: criar pública/privada, entrar por código, mesas públicas ao vivo, resumo das regras) e `/uno/[code]` (sala).
- `src/features/uno/`: `connection.ts` (socket compartilhado, join/rejoin com fila de eventos, ações com `actionId`), `store.ts` (zustand; version/seq; efeitos visuais), `reactions.ts` (anúncio → grito/banner/som/voz), `rules-view.ts` (posições dos oponentes em arco por quantidade, ações disponíveis, rótulos), componentes: `uno-card`, `uno-home`, `public-tables`, `room-lobby` (lugares, regras da casa, modo), `table-view`, `table-center` (monte, descarte, anel de cor e seta de sentido girando), `opponent-seat` (avatar, contagem em leque, anel de tempo, balão de emote), `my-hand` (leque, jogáveis levantadas, demais esmaecidas), `color-picker`, `target-picker` (7-0), `uno-controls` (UNO!, Pegou!, Desafiar/Recusar, Passar), `result-panel`, `shout-overlay`, `uno-art`, `uno.module.css`.
- Catálogo de jogos ganha o card "UNO"; dock inclui `/uno`.
- Sons novos sintetizados em `sfx.ts` (`uno-call`, `uno-draw`, `uno-skip`, `uno-wild`, `uno-turn`); voz pt-BR nos momentos grandes ("UNO!", "Pegou!", "Compra quatro!").

## Erros e segurança

- Identidade = `sub` do JWT; apelido obrigatório. Cliente nunca informa lugar, vez, cor atual, pontuação ou destinatário.
- Toda ação valida fase, vez e jogada no engine (`NOT_YOUR_TURN`, `INVALID_MOVE`, `INVALID_STATE`).
- Rate limit e dedupe por `actionId` iguais ao Truco; payloads Zod `strict` no create.
- Um usuário em no máximo uma mesa (Truco e UNO são independentes).

## Testes

- `engine/deck.spec.ts`, `engine/match.spec.ts`: composição do baralho, jogadas válidas, efeitos, primeira carta, 2 jogadores, desafio (sucesso/falha), UNO/pegou, empilhar, 7-0, timeout, saída, reembaralhar, pontuação, fim por pontos e por abandono.
- `uno-rooms.service.spec.ts`: salas, 7º jogador, início com ≥ 2, privacidade da mão, seq/version, timer de vez, reconexão/expiração, lista pública, regras.
- `uno.gateway.spec.ts`: Nest real + 2–3 clientes `socket.io-client`.
- Front (vitest): store, reactions, rules-view, room screen, home, lobby, table view.

## Fora do escopo

Bots, jump-in (cortar), ranking/moedas, persistência, múltiplas instâncias, 7–10 jogadores.
