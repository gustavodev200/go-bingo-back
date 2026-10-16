# Snake.io — arena aberta multiplayer em tempo real

Arena .io no estilo Snake.io/Slither: cada um controla uma cobra, come pontos para crescer e elimina os outros
fazendo-os bater no próprio corpo. Roda sobre Socket.IO no mesmo servidor NestJS dos outros jogos
(namespace `/snake`, sem infraestrutura nova).

## Arquitetura

```
front (Next)                          back (NestJS)
features/snake ──socket.io /snake──▶ SnakeGateway         auth JWT, Zod, rate limit
  interpolação ~100 ms                 │
  canvas neon                          ▼
                                     SnakeArenasService   autoridade: arenas, jogadores, CPU, loop 20 Hz, ranking
                                       │
                                       ▼
                                     Arena (engine)       regras puras: movimento, grade espacial, colisões, comida
                                     snakeBotThink        IA das CPUs
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/snake.ts` | Constantes, skins, schemas Zod, eventos e o **codec binário do frame** (servidor codifica, front decodifica). |
| `src/snake/engine/arena.ts` | Arena: movimento com giro limitado, corpo em corrente, grade espacial, colisões, comida, restos, impulso. |
| `src/snake/engine/bot.ts` | CPU: leque de direções à frente (corpos, borda e cabeças em movimento), persegue comida, às vezes caça cobras menores. |
| `src/snake/snake-arenas.service.ts` | Arenas em memória, jogadores (espectador → jogando → morto), população de CPU, frames por jogador e ranking. |
| `src/snake/snake.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit. |
| `src/snake/snake-publisher.ts` | Emissão por socket (frames voláteis) e para o canal `arena:ID`. |

## Regras

- Arena circular de raio 3000. Encostar a cabeça na borda vermelha mata.
- Cabeça no corpo de outra cobra mata (o próprio corpo não). Cabeça com cabeça: a claramente maior vence; parecidas morrem as duas.
- Pontos coloridos dão massa; massa aumenta comprimento e espessura. Cobra grande vira mais devagar e enxerga mais longe.
- Ao morrer, ~80% da massa vira restos brilhantes nas cores da cobra (somem em 60 s).
- Impulso: 360 em vez de 170 unidades/s, gasta 7 de massa/s (cai como pontos atrás da cauda). Precisa de massa > 15.
- CPUs completam cada arena até `SNAKE_BOTS` cobras enquanto há poucos humanos; nenhuma CPU segura a arena: sem humanos ela é apagada.

## Eventos (`/snake`)

Cliente → servidor:

| Evento | Payload | Ack |
|---|---|---|
| `snake:join` | `{}` | `{ arena, radius, meta: [id, nome, skin][] }` — entra como espectador (câmera no líder) |
| `snake:play` | `{ skin }` (0–11) | `{ id }` — nasce uma cobra com o apelido do perfil |
| `snake:leave` | `{}` | `null` — a cobra viva morre |
| `snake:input` | `{ a, b }` direção absoluta (rad) e impulso | sem ack |
| `snake:view` | `{ w, h }` unidades do mundo visíveis (limitado a 300–4000) | sem ack |

Servidor → cliente: `snake:frame` (binário, volátil, 20 Hz, só o que cabe na tela do jogador), `snake:meta`,
`snake:leaderboard` (1 Hz: top 10, minimapa, posição), `snake:feed` (abates), `snake:dead` (resumo da partida).

## Rede

- Servidor autoritativo a 20 Hz. O cliente manda só direção + impulso quando mudam (≤ 30/s).
- Frame binário com Int16 em meias unidades: ~1 KB por frame (~20 KB/s por jogador).
- Inputs: limite 60/s; view 10/s; demais ações 10/s. Payload inválido é descartado em silêncio.
- Socket caiu = cobra morre (estilo .io, sem reserva de lugar). Um novo socket do mesmo usuário assume o jogador.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `SNAKE_BOTS` | 16 | CPUs por arena enquanto há poucos humanos (0 = só humanos). |
| `SNAKE_MAX_PLAYERS` | 40 | Humanos por arena; ao lotar abre outra. |
| `SNAKE_MAX_ARENAS` | 20 | Arenas em memória (cada uma roda um loop de 20 Hz). |

## Limitações

Estado só em memória (deploy encerra arenas), uma instância, sem ranking/moedas persistentes.

## Testes

`src/snake/engine/arena.spec.ts`, `src/snake/snake-arenas.service.spec.ts` e `src/snake/snake.gateway.spec.ts`
(Nest real + clientes `socket.io-client`, sem banco). Rodam com `npm test`.
