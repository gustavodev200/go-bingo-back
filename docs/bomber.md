# Bomberman — batalha multiplayer em tempo real

Modo Batalha do Super Bomberman para 2 a 8 jogadores (humanos e CPU) sobre Socket.IO no mesmo
servidor NestJS dos outros jogos (namespace `/bomber`, sem infraestrutura nova).

## Arquitetura

```
front (Next)                           back (NestJS)
features/bomber ──socket.io /bomber──▶ BomberGateway        auth JWT, Zod, rate limit
  predição do próprio boneco             │
  interpolação dos outros                ▼
  canvas pixel-art                     BomberRoomsService   autoridade: salas, lugares, cores, CPU, loop 30 Hz
                                         │
                                         ▼
                                       BomberRound (engine) regras puras, passo fixo, sem transporte nem relógio
                                       botThink             IA das CPUs (mapa de perigo + BFS)
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/bomber.ts` | Constantes, tipos, schemas Zod, eventos e o **movimento em grade** (`movePlayer`), usado pelo servidor e pela predição do front (`npm run contracts:sync`). |
| `src/bomber/engine/round.ts` | Rodada: mapa, bombas, chamas em cruz, reação em cadeia, itens, maldições, chute, luva, remoto, morte súbita, fim. |
| `src/bomber/engine/bot.ts` | CPU: foge do perigo, pega itens, bomba blocos/jogadores só quando tem rota de fuga. |
| `src/bomber/bomber-rooms.service.ts` | Salas em memória (8 lugares), pública/privada, prontidão, cores, CPU, rodadas e placar, reconexão, anfitrião. |
| `src/bomber/bomber.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit. |
| `src/bomber/bomber-publisher.ts` | Emissão para `room:CODE`, frames voláteis e lista pública (debounce 300 ms). |

## Regras

- Arena 15×13: pilares fixos, blocos quebráveis aleatórios, cantos livres para nascer. Os lugares de nascimento são sorteados a cada rodada.
- Bomba explode em cruz depois de 2,6 s, atinge quem estiver no alcance (inclusive o dono) e detona outras bombas em cadeia.
- Bloco quebrado pode soltar item (40%): Bomba +1, Fogo +1, Patins, Chute, Luva, Controle remoto, Fogo máximo e Caveira.
- Caveira: maldição aleatória por 12 s (lento, hiper-rápido, fogo fraco, sem bombas, bombas descontroladas, controles invertidos) que passa para quem encostar.
- Quem morre espalha os itens que tinha pelo mapa.
- Com 0:50 restantes começa a morte súbita: blocos caem em espiral fechando a arena.
- Último de pé vence a rodada (empate se os últimos morrem juntos). Vence a partida quem chegar primeiro a `winsToWin` rodadas (1–5, padrão 3, o anfitrião escolhe).

## Eventos (`/bomber`)

Cliente → servidor (ack `{ ok, data } | { ok: false, error }`):

| Evento | Payload |
|---|---|
| `bomber:create` | `{ isPublic? }` → snapshot |
| `bomber:watch_rooms` / `bomber:unwatch_rooms` | `{}` |
| `bomber:set_visibility` | `{ isPublic }` (anfitrião) |
| `bomber:set_rules` | `{ rules: { winsToWin } }` (anfitrião, lobby) |
| `bomber:join` | `{ code }` → snapshot (também é a reconexão) |
| `bomber:sync` / `bomber:leave` / `bomber:start` / `bomber:rematch` / `bomber:add_bot` | `{}` |
| `bomber:ready` | `{ ready }` |
| `bomber:set_color` | `{ color }` (0–7, única por sala) |
| `bomber:remove_bot` | `{ seat }` (anfitrião) |
| `bomber:input` | `{ s, d, b, a }` — **sem ack**, um por tick do cliente |

Servidor → cliente: `bomber:state` (com `version`), `bomber:frame` (30 Hz, volátil), `bomber:rooms_updated`,
e anúncios com `seq`: `player_joined`, `player_left`, `player_disconnected`, `player_reconnected`,
`match_started`, `round_started`, `round_ended`, `match_over`.

## Rede

- Servidor autoritativo a 30 Hz. O cliente manda só direção e botões com número de sequência; o servidor
  devolve `lastSeq` de cada jogador no frame e o cliente reaplica os inputs ainda não confirmados
  (mesmo `movePlayer` dos contratos), então o próprio boneco responde na hora.
- Os outros bonecos são interpolados ~70 ms no passado.
- Inputs: limite de 60/s por socket; payload inválido é descartado em silêncio. Demais ações: 10/s, criação 3/10 s.

## Tempo, reconexão e abandono

- Ao cair o último socket o lugar fica reservado por `BOMBER_RECONNECT_GRACE_MS` (o boneco fica parado na arena).
- Prazo vencido ou "Sair": no lobby o lugar é liberado; na partida o boneco morre e o jogo segue.
  Se sobrar um só, ele leva a partida. CPUs não seguram a sala: sem humanos ela é apagada.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `BOMBER_RECONNECT_GRACE_MS` | 30000 | Janela de reconexão. |
| `BOMBER_ROUND_PAUSE_MS` | 3500 | Pausa entre rodadas. |
| `BOMBER_MAX_ROOMS` | 300 | Limite de salas em memória (cada uma roda um loop de 30 Hz durante a partida). |

## Limitações

Estado só em memória (deploy encerra salas), uma instância, sem ranking/moedas.

## Testes

`src/bomber/engine/round.spec.ts`, `src/bomber/bomber-rooms.service.spec.ts` e `src/bomber/bomber.gateway.spec.ts`
(Nest real + clientes `socket.io-client`, sem banco). Rodam com `npm test`.
