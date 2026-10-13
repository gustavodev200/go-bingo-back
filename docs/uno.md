# UNO — multiplayer em tempo real

UNO para 2 a 6 humanos sobre Socket.IO no mesmo servidor NestJS do Bingo e do Truco
(namespace `/uno`, sem infraestrutura nova). Design: `docs/superpowers/specs/2026-10-13-uno-design.md`.

## Arquitetura

```
front (Next)                         back (NestJS)
features/uno ──socket.io /uno──▶     UnoGateway         auth JWT, Zod, rate limit, dedupe por actionId
  store (zustand, version/seq)         │
  reactions (grito, som, voz)          ▼
                                     UnoRoomsService    autoridade: salas, lugares, presença, timers
                                       │
                                       ▼
                                     UnoMatch (engine)  regras puras, sem transporte nem relógio
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/uno.ts` | Tipos, regras, schemas Zod e nomes de eventos (copiado para o front por `npm run contracts:sync`). |
| `src/uno/engine/deck.ts` | Baralho oficial de 108 cartas e `canPlayOn`. |
| `src/uno/engine/match.ts` | Rodadas, vez/sentido, efeitos, compra, desafio do +4, UNO/pegou, empilhar, 7-0, tempo esgotado, saída, pontuação. |
| `src/uno/uno-rooms.service.ts` | Salas em memória (6 lugares), prontidão, regras da mesa, relógio da vez, pausa entre rodadas, reconexão, anfitrião, lista pública. |
| `src/uno/uno.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit, deduplicação. |
| `src/uno/uno-publisher.ts` | Emissão para `room:CODE`, `user:ID` e a lista pública (debounce 300 ms). |

## Regras implementadas

- 108 cartas: por cor um 0 e dois de cada 1–9, Pular, Inverter e +2; 4 Coringas e 4 Coringas +4. 7 cartas por jogador.
- Vale jogar carta da mesma cor, do mesmo número/símbolo, ou coringa (com escolha de cor).
- Primeira carta: coringa volta ao monte; Pular pula o primeiro; Inverter inverte (com 2 = pular); +2 faz o primeiro comprar 2.
- Na sua vez você pode comprar 1 carta (mesmo tendo jogável). Se ela servir, joga ou passa; se não, a vez passa.
- Inverter com 2 jogadores funciona como Pular.
- +4 pode ser jogado sempre. O próximo **desafia** ou **recusa** (compra 4 e perde a vez). Desafio certo
  (quem jogou tinha a cor da mesa): quem jogou compra 4 e o desafiante joga normalmente. Desafio errado: o desafiante compra 6 e perde a vez.
- UNO!: grite com 2 cartas na sua vez (antes de jogar) ou com 1 carta. Quem fica com 1 carta sem gritar fica exposto até
  outro jogador agir; qualquer outro pode apertar "Pegou!" e o exposto compra 2.
- Fim da rodada ao zerar a mão; +2/+4 final ainda faz o próximo comprar. O vencedor soma as cartas dos outros
  (número = valor, ação = 20, coringa = 50).
- Modos: rodada única (padrão), corrida dos 200 ou dos 500. Entre rodadas há pausa de `UNO_ROUND_PAUSE_MS` e quem começa gira.
- Regras da casa (anfitrião, no lobby): **Empilhar** (+2 sobre +2; +4 sobre +2/+4; desafio só no +4 não empilhado) e
  **7-0** (7 troca de mão com quem escolher; 0 gira todas as mãos no sentido do jogo).
- Monte vazio: o descarte (menos a carta do topo) é embaralhado de novo.

Não implementado: cortar (jump-in), bots, 7–10 jogadores.

## Eventos (`/uno`)

Cliente → servidor (ack `{ ok, data } | { ok: false, error }`):

| Evento | Payload |
|---|---|
| `uno:create` | `{ isPublic? }` → snapshot |
| `uno:watch_rooms` / `uno:unwatch_rooms` | `{}` |
| `uno:set_visibility` | `{ isPublic }` (anfitrião) |
| `uno:set_rules` | `{ rules: { target: 0\|200\|500, stacking, sevenZero } }` (anfitrião, lobby) |
| `uno:join` | `{ code }` → snapshot (também é a reconexão) |
| `uno:sync` / `uno:leave` / `uno:start` / `uno:rematch` | `{}` |
| `uno:ready` | `{ ready }` |
| `uno:play_card` | `{ actionId, cardId, color?, target? }` |
| `uno:draw` / `uno:pass` / `uno:challenge` / `uno:call_uno` / `uno:catch_uno` | `{ actionId }` |
| `uno:emote` | `{ emote }` |

Servidor → cliente: `uno:state` (com `version`), `uno:private_hand` (só o dono), `uno:rooms_updated`,
`uno:room_closed`, `uno:emoted` e anúncios com `seq`: `player_joined`, `player_left`, `player_disconnected`,
`player_reconnected`, `match_started`, `round_started`, `card_played`, `cards_drawn`, `turn_skipped`,
`direction_changed`, `hands_swapped`, `hands_rotated`, `challenge_resolved`, `uno_called`, `uno_caught`,
`turn_timed_out`, `round_ended`, `match_over`.

## Segurança e privacidade

- Identidade = `sub` do JWT; apelido obrigatório. O cliente nunca informa lugar, vez, cor da mesa, pontos ou destinatário.
- Estado público só tem contagens. Cada mão vai para o canal do próprio usuário. Ids de carta são dados depois do
  embaralhamento e não revelam a carta. As cartas jogáveis são calculadas no servidor.
- Rate limit por socket: 10 ações/s, 3 criações/10 s, 1 emote/s. Ações de jogo levam `actionId` (repetição devolve a resposta original).

## Tempo, reconexão e abandono

- Cada vez tem prazo `UNO_TURN_MS` (`round.turnDeadline` no estado). Estourou: carta comprada é mantida, compra pendente
  é comprada, ou compra 1 e passa.
- Ao cair o último socket o lugar fica reservado por `UNO_RECONNECT_GRACE_MS`; as vezes do ausente seguem no relógio.
- Prazo vencido ou "Sair": no lobby o lugar é liberado; na partida as cartas voltam ao monte e o jogo segue. Sobrando 1, ele vence (`abandoned`).
- A mesa é apagada quando o último jogador sai. "Jogar de novo" volta ao lobby com os mesmos lugares.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `UNO_RECONNECT_GRACE_MS` | 60000 | Janela de reconexão. |
| `UNO_TURN_MS` | 25000 | Tempo por jogada. |
| `UNO_ROUND_PAUSE_MS` | 4000 | Pausa entre rodadas. |
| `UNO_MAX_ROOMS` | 1000 | Limite de mesas em memória. |

## Limitações

Iguais às do Truco: estado só em memória (deploy encerra mesas), uma instância, sem ranking/moedas.

## Testes

`src/uno/engine/*.spec.ts`, `src/uno/uno-rooms.service.spec.ts` e `src/uno/uno.gateway.spec.ts`
(Nest real + clientes `socket.io-client`, sem banco). Rodam com `npm test`.
