# Snake.io — salas multiplayer em tempo real

Snake.io/Slither em salas públicas ou privadas (código de 6 letras), até 20 jogadores, só humanos online:
cada um controla uma cobra, come pontos para crescer e elimina os outros fazendo-os bater no próprio corpo.
Dentro da sala a arena roda sem parar: entra, joga, morre e joga de novo quando quiser. Roda sobre Socket.IO no mesmo servidor NestJS dos outros jogos
(namespace `/snake`, sem infraestrutura nova).

## Arquitetura

```
front (Next)                          back (NestJS)
features/snake ──socket.io /snake──▶ SnakeGateway         auth JWT, Zod, rate limit
  interpolação ~100 ms                 │
  canvas neon                          ▼
                                     SnakeRoomsService    autoridade: salas, jogadores, anfitrião, loop 20 Hz, ranking
                                       │
                                       ▼
                                     Arena (engine)       regras puras: movimento, grade espacial, colisões, comida
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/snake.ts` | Constantes, skins, schemas Zod, eventos e o **codec binário do frame** (servidor codifica, front decodifica). |
| `src/snake/engine/arena.ts` | Arena: movimento com giro limitado, corpo em corrente, grade espacial, colisões, comida, restos, impulso. |
| `src/snake/snake-rooms.service.ts` | Salas em memória (pública/privada, 20 lugares), anfitrião, reconexão, jogadores (assistindo → jogando → morto), frames por jogador e ranking. |
| `src/snake/snake.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit. |
| `src/snake/snake-publisher.ts` | Emissão por socket (frames voláteis), para `room:CODE` e lista pública (debounce 300 ms). |

## Regras

- Arena circular de raio 2000 (cabe bem até 20 cobras). Encostar a cabeça na borda vermelha mata.
- Cabeça no corpo de outra cobra mata (o próprio corpo não). Cabeça com cabeça: a claramente maior vence; parecidas morrem as duas.
- Pontos coloridos dão massa; massa aumenta comprimento e espessura. Cobra grande vira mais devagar e enxerga mais longe.
- Ao morrer, ~80% da massa vira restos brilhantes nas cores da cobra (somem em 60 s).
- Impulso: 360 em vez de 170 unidades/s, gasta 7 de massa/s (cai como pontos atrás da cauda). Precisa de massa > 15.
- Sem CPU: só jogadores de verdade. Só dá para nascer com pelo menos 2 jogadores conectados na sala (quem já está vivo continua se os outros saírem). A sala é apagada quando o último sai.

## Eventos (`/snake`)

Cliente → servidor (ack `{ ok, data } | { ok: false, error }`):

| Evento | Payload | Ack |
|---|---|---|
| `snake:create` | `{ isPublic? }` | snapshot `{ state, radius, meta }` |
| `snake:watch_rooms` / `snake:unwatch_rooms` | `{}` | lista pública / `null` |
| `snake:join` | `{ code }` | snapshot (também é a reconexão) |
| `snake:set_visibility` | `{ isPublic }` (anfitrião) | `null` |
| `snake:play` | `{ skin }` (índice em `SNAKE_SKINS`: 12 neon + 20 clubes da Série A 2026) | `{ id }` — nasce uma cobra com o apelido do perfil |
| `snake:leave` | `{}` | `null` — sai da sala (a cobra viva morre) |
| `snake:input` | `{ a, b }` direção absoluta (rad) e impulso | sem ack |
| `snake:view` | `{ w, h }` unidades do mundo visíveis (limitado a 300–4000) | sem ack |

Servidor → cliente: `snake:state` (sala, com `version`), `snake:rooms_updated`, `snake:frame` (binário, volátil, 20 Hz,
só o que cabe na tela do jogador), `snake:meta`, `snake:leaderboard` (1 Hz: top 10, minimapa, posição),
`snake:feed` (abates), `snake:dead` (resumo da vida).

## Rede

- Servidor autoritativo a 20 Hz. O cliente manda só direção + impulso quando mudam (≤ 30/s).
- Frame binário com Int16 em meias unidades: ~1 KB por frame (~20 KB/s por jogador).
- Inputs: limite 60/s; view 10/s; demais ações 10/s; criar sala 3/10 s. Payload inválido é descartado em silêncio.
- Socket caiu = a cobra morre (estilo .io), mas o lugar na sala fica reservado por `SNAKE_RECONNECT_GRACE_MS`; o anfitrião passa para alguém conectado.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `SNAKE_RECONNECT_GRACE_MS` | 30000 | Janela de reconexão. |
| `SNAKE_MAX_ROOMS` | 200 | Salas em memória (cada uma roda um loop de 20 Hz). |

## Limitações

Estado só em memória (deploy encerra arenas), uma instância, sem ranking/moedas persistentes.

## Testes

`src/snake/engine/arena.spec.ts`, `src/snake/snake-arenas.service.spec.ts` e `src/snake/snake.gateway.spec.ts`
(Nest real + clientes `socket.io-client`, sem banco). Rodam com `npm test`.

## Desempenho no cliente

O front desenha com sprites pré-renderizados copiados 1:1 em pixels inteiros e ajusta a qualidade sozinho
(resolução, densidade de segmentos, efeitos e 30 fps no modo leve) conforme o tempo real de cada frame.
