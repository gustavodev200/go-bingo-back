# Dominó — multiplayer em tempo real

Dominó clássico (duplo-6) para 2 a 4 humanos sobre Socket.IO no mesmo servidor NestJS dos outros jogos
(namespace `/domino`, sem infraestrutura nova). Mesmo desenho do UNO: engine puro, serviço de salas como autoridade
e gateway só de transporte.

## Arquitetura

```
front (Next)                           back (NestJS)
features/domino ──socket.io /domino──▶ DominoGateway        auth JWT, Zod, rate limit, dedupe por actionId
  store (zustand, version/seq)           │
  mesa em SVG (serpentina)               ▼
                                       DominoRoomsService   autoridade: salas, lugares, presença, timers
                                         │
                                         ▼
                                       DominoMatch (engine) regras puras, sem transporte nem relógio
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/domino.ts` | Tipos, regras, schemas Zod e nomes de eventos (copiado para o front por `npm run contracts:sync`). |
| `src/domino/engine/tiles.ts` | As 28 peças do duplo-6. |
| `src/domino/engine/match.ts` | Distribuição, saída, encaixe nas pontas, compra, passe, jogo trancado, duplas, pontuação, tempo esgotado, saída de jogador. |
| `src/domino/domino-rooms.service.ts` | Salas em memória (4 lugares), prontidão, regras da mesa, relógio da vez, pausa entre rodadas, reconexão, anfitrião, lista pública. |
| `src/domino/domino.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit, deduplicação. |
| `src/domino/domino-publisher.ts` | Emissão para `room:CODE`, `user:ID` e a lista pública (debounce 300 ms). |

## Regras implementadas

- 28 peças de 0|0 (branco) a 6|6. Cada jogador recebe 7; o que sobra é o monte (com 4 jogadores não há monte).
- Sai quem tem a maior carroça (6|6, senão 5|5…) e é obrigado a jogá-la. Sem carroças, sai a peça de maior soma.
  Nas rodadas seguintes começa quem venceu a anterior, com qualquer peça (depois de empate, volta a regra da carroça).
- A vez segue a ordem dos lugares, desenhada no sentido anti-horário na mesa.
- Joga-se uma peça com o número de uma das pontas abertas. Se ela serve nas duas pontas com números diferentes,
  o jogador escolhe a ponta; com pontas iguais o servidor cresce o lado mais curto.
- Sem peça que sirva: com monte, "Comprar" compra até achar uma que sirva (ou o monte acabar) e a vez continua;
  sem monte, o servidor passa a vez sozinho (`turn_passed`).
- Fim da rodada: quem bate (zera a mão) vence; ou o jogo tranca (ninguém pode jogar e o monte acabou) e vence a menor
  soma na mão. Empate na menor soma não pontua.
- O vencedor soma os pontos que sobraram nas mãos dos perdedores.
- Duplas (regra do anfitrião, exige 4 jogadores): lugares 0+2 contra 1+3, parceiros frente a frente. Quem bate leva a
  dupla; no trancado compara a soma de cada dupla. Os dois parceiros recebem os pontos.
- Modos: rodada única (padrão), até 50 ou até 100 pontos. Entre rodadas há pausa de `DOMINO_ROUND_PAUSE_MS`.

Não implementado: dominó de quatro pontas (spinner), bots, pontuação por múltiplos de 5 ("all fives").

## Eventos (`/domino`)

Cliente → servidor (ack `{ ok, data } | { ok: false, error }`):

| Evento | Payload |
|---|---|
| `domino:create` | `{ isPublic? }` → snapshot |
| `domino:watch_rooms` / `domino:unwatch_rooms` | `{}` |
| `domino:set_visibility` | `{ isPublic }` (anfitrião) |
| `domino:set_rules` | `{ rules: { target: 0\|50\|100, teams } }` (anfitrião, lobby) |
| `domino:join` | `{ code }` → snapshot (também é a reconexão) |
| `domino:sync` / `domino:leave` / `domino:start` / `domino:rematch` | `{}` |
| `domino:ready` | `{ ready }` |
| `domino:play` | `{ actionId, tileId, side? }` (`side`: `left`\|`right`) |
| `domino:draw` | `{ actionId }` |
| `domino:emote` | `{ emote }` |

Servidor → cliente: `domino:state` (com `version`), `domino:private_hand` (só o dono), `domino:rooms_updated`,
`domino:room_closed`, `domino:emoted` e anúncios com `seq`: `player_joined`, `player_left`, `player_disconnected`,
`player_reconnected`, `match_started`, `round_started`, `tile_played`, `tiles_drawn`, `turn_passed`,
`turn_timed_out`, `round_ended`, `match_over`.

O estado público traz a linha (`round.line`, da ponta esquerda à direita, cada peça orientada), o índice da primeira
peça (`round.origin`, de onde o desenho cresce), as pontas, o tamanho do monte e as contagens das mãos.

## Segurança e privacidade

- Identidade = `sub` do JWT; apelido obrigatório. O cliente nunca informa lugar, vez, pontas, pontos ou destinatário.
- Estado público só tem contagens. Cada mão vai para o canal do próprio usuário. Ids de peça são dados depois do
  embaralhamento e não revelam a peça. As peças jogáveis (e em que ponta) são calculadas no servidor.
- Rate limit por socket: 10 ações/s, 3 criações/10 s, 1 emote/s. Ações de jogo levam `actionId` (repetição devolve a resposta original).

## Tempo, reconexão e abandono

- Cada vez tem prazo `DOMINO_TURN_MS` (`round.turnDeadline`). Estourou: compra se precisar e joga a peça mais pesada
  que serve, ou passa.
- Ao cair o último socket o lugar fica reservado por `DOMINO_RECONNECT_GRACE_MS`; as vezes do ausente seguem no relógio.
- Prazo vencido ou "Sair": no lobby o lugar é liberado; na partida individual as peças voltam ao monte e o jogo segue
  (sobrando 1, ele vence, `abandoned`); em duplas a outra dupla vence na hora.
- A mesa é apagada quando o último jogador sai. "Jogar de novo" volta ao lobby com os mesmos lugares.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `DOMINO_RECONNECT_GRACE_MS` | 60000 | Janela de reconexão. |
| `DOMINO_TURN_MS` | 25000 | Tempo por jogada. |
| `DOMINO_ROUND_PAUSE_MS` | 5000 | Pausa entre rodadas. |
| `DOMINO_MAX_ROOMS` | 1000 | Limite de mesas em memória. |

## Limitações

Iguais às do UNO: estado só em memória (deploy encerra mesas), uma instância, sem ranking/moedas.

## Testes

`src/domino/engine/match.spec.ts`, `src/domino/domino-rooms.service.spec.ts` e `src/domino/domino.gateway.spec.ts`
(Nest real + clientes `socket.io-client`, sem banco). Rodam com `npm test`.
