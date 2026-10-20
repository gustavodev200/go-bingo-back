# Infiltrado — dedução social na Estação Abissal

Jogo de dedução social para 4 a 15 jogadores (humanos e CPU) sobre Socket.IO no mesmo servidor NestJS
dos outros jogos (namespace `/infiltrado`, sem infraestrutura nova). A tripulação faz tarefas e caça os
infiltrados; os infiltrados eliminam, usam dutos e sabotam a base submarina.

## Arquitetura

```
front (Next)                               back (NestJS)
features/infiltrado ──socket.io /infiltrado──▶ InfGateway         auth JWT, Zod, rate limit
  predição do próprio mergulhador               │
  interpolação dos outros (100 ms)              ▼
  canvas + névoa por raycast               InfRoomsService      salas, lugares, cores, CPU, loop 20 Hz,
  mini-games das tarefas                        │               um frame privado por jogador
                                                ▼
                                           InfMatch (engine)    regras puras, passo fixo, sem transporte
                                           botThink / botVote   IA das CPUs (BFS no mapa)
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/infiltrado.ts` | Mapa (salas, corredores, painéis, dutos, botão), movimento com colisão (`infMove`), linha de visão (`infLineOfSight`, `infRayLength`), regras, frames e eventos. O front usa o mesmo código para a predição e a névoa (`npm run contracts:sync`). |
| `src/infiltrado/engine/match.ts` | Partida: papéis, tarefas, eliminação, corpos, reuniões, votação, ejeção, sabotagens, dutos, chat, condições de vitória e o frame de cada jogador. |
| `src/infiltrado/engine/bot.ts` | CPU: faz tarefas (ou finge), conserta sabotagens críticas, reporta corpos, persegue alvos sozinhos, vota em quem viu matar. |
| `src/infiltrado/infiltrado-rooms.service.ts` | Salas em memória (15 lugares), pública/privada, prontidão, cores, CPU, reconexão, anfitrião, Arena. |
| `src/infiltrado/infiltrado.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit. |
| `src/infiltrado/infiltrado-publisher.ts` | Estado da sala para `room:CODE`; frames e chat para o canal de cada usuário; lista pública (debounce 300 ms). |

## Regras

- **Papéis secretos** sorteados no início: 1 a 3 infiltrados (o anfitrião escolhe; o máximo cai com poucos
  jogadores: até 6 → 1, até 9 → 2, 10+ → 3). Infiltrados se conhecem.
- **Tarefas** (2 a 8 por tripulante, padrão 5) em 18 painéis de 8 tipos: religar cabos, calibrar sonar,
  sequência numérica, encher tanque, limpar filtro, transferir dados, alinhar válvula e escaneamento.
  O servidor exige abrir o painel perto dele e um tempo mínimo por tipo antes de aceitar a conclusão.
  Fantasmas da tripulação continuam fazendo tarefas. A barra conta todos os tripulantes ainda na sala.
- **Eliminar**: infiltrado vivo, fora do duto, alvo a até 1,7 de distância com linha de visão, recarga
  configurável (padrão 30 s; 15 s no início, recarga cheia depois de cada reunião). Fica um corpo.
- **Dutos**: 9 dutos em 3 redes; dentro do duto o infiltrado some para todos e pode pular para os ligados.
- **Sabotagens** (recarga de 30 s, uma por vez, até fantasmas infiltrados sabotam):
  luzes (a visão da tripulação cai para 1,8 até ligarem os disjuntores na Elétrica), oxigênio (crítico:
  digitar o código em 2 painéis em 45 s) e reator (crítico: duas pessoas seguram os scanners ao mesmo tempo).
  Crítico não consertado = vitória dos infiltrados. Toda reunião encerra a sabotagem.
- **Reuniões**: reportar um corpo (a até 2,4) ou o botão do Átrio (1 a 3 por jogador, travado 15 s depois do
  início/de cada reunião e durante sabotagem crítica). Discussão (0–120 s) e votação (15–180 s); quem estava
  vivo vota em alguém ou pula. Mais votos ejeta; empate ou maioria de "pular" não ejeta ninguém. A votação
  fecha quando todos votam. "Revelar quem foi ejetado" é configurável.
- **Chat**: vivos conversam só nas reuniões; fantasmas conversam entre si a qualquer momento e só fantasmas veem.
- **Vitória**: tripulação completa as tarefas ou ejeta todos os infiltrados; infiltrados ficam em número igual
  ou maior que a tripulação viva, ou uma sabotagem crítica não é consertada. Quem sai no meio é tirado de
  todas as contagens (sem corpo) e pode decidir a partida.

## Sigilo

O estado da sala (`inf:state`) nunca carrega papéis até a partida acabar (`result.impostors`).
Cada jogador recebe o próprio `inf:frame`:

- vivo: só vê quem está dentro do raio de visão **e** com linha de visão (paredes bloqueiam), nunca fantasmas
  nem quem está no duto; corpos idem;
- fantasma: vê todos (vivos e fantasmas) e todos os corpos;
- infiltrado: recebe os parceiros em `me.mates` e marcados com a flag 2.

## Eventos (`/infiltrado`)

Cliente → servidor (ack `{ ok, data } | { ok: false, error }`):

| Evento | Payload |
|---|---|
| `inf:create` | `{ isPublic? }` → snapshot |
| `inf:watch_rooms` / `inf:unwatch_rooms` | `{}` |
| `inf:set_visibility` | `{ isPublic }` (anfitrião) |
| `inf:set_rules` | `{ rules }` (anfitrião, lobby) |
| `inf:join` | `{ code }` → snapshot (também é a reconexão) |
| `inf:sync` / `inf:leave` / `inf:start` / `inf:rematch` / `inf:add_bot` | `{}` |
| `inf:ready` | `{ ready }` |
| `inf:set_color` | `{ color }` (0–14, única por sala) |
| `inf:remove_bot` | `{ seat }` (anfitrião) |
| `inf:act` | `{ t: 'task_open' \| 'task_done', station }`, `{ t: 'kill', target }`, `{ t: 'report', body }`, `{ t: 'emergency' }`, `{ t: 'vent_enter' \| 'vent_exit' }`, `{ t: 'vent_move', to }`, `{ t: 'sabotage', kind }`, `{ t: 'fix', panel }`, `{ t: 'hold', panel, on }`, `{ t: 'vote', target }` (-1 = pular) |
| `inf:chat` | `{ text }` (1–120) |
| `inf:input` | `{ s, x, y }` — joystick analógico, **sem ack**, um por tick do cliente |

Servidor → cliente: `inf:state` (com `version`), `inf:frame` (20 Hz em jogo, 5 Hz em reunião/ejeção,
volátil, por jogador), `inf:chat`, `inf:rooms_updated` e anúncios com `seq`: `player_joined`,
`player_left`, `player_disconnected`, `player_reconnected`, `match_started`, `match_over`.

## Rede e desempenho

- Servidor autoritativo a 20 Hz; o cliente manda o vetor do joystick com número de sequência e prediz o
  próprio movimento com o mesmo `infMove` (colisão por eixo contra as paredes). Os outros são interpolados.
- Visão por jogador: ~200 testes de linha de visão por tick numa sala cheia (DDA na grade 64×40).
- O mapa é pré-renderizado uma vez num canvas; cada quadro só recorta a parte visível e desenha a névoa com
  um polígono de visibilidade (200 raios).
- Limites: inputs 60/s por socket (excesso descartado em silêncio), ações 10/s, chat 4 a cada 3 s,
  criação 3 a cada 10 s.

## Arena

`INFILTRADO` na Arena: entrada 30, bônus 40, peso 0,7, mínimo de 2 min para pontuar. O time vencedor fica
em 1º (divide o pote), o outro em 2º; quem abandona paga a multa. CPU não entra. Migration
`20261019120000_arena_infiltrado` adiciona o valor ao enum `ArenaGame`.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `INF_RECONNECT_GRACE_MS` | 45000 | Janela de reconexão (o mergulhador fica parado na estação). |
| `INF_MAX_ROOMS` | 200 | Limite de salas em memória. |
