# Futebol de Botão — racha multiplayer em tempo real

Futebol estilo HaxBall para 2 a 8 jogadores (até 4 contra 4, humanos e CPU) sobre Socket.IO no mesmo
servidor NestJS dos outros jogos (namespace `/botao`, sem infraestrutura nova).

## Arquitetura

```
front (Next)                          back (NestJS)
features/botao ──socket.io /botao──▶ BotaoGateway        auth JWT, Zod, rate limit
  previsão do próprio botão            │
  interpolação da bola e dos outros    ▼
  canvas 2D (campo gira em pé)       BotaoRoomsService   autoridade: salas, times, CPU, loop 30 Hz, placar
                                       │
                                       ▼
                                     BotaoMatch (engine) física, gols, saída de bola, tempo, gol de ouro
                                     botThink            CPU: ataca quem está mais perto da bola, o resto defende
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/botao.ts` | Constantes, tipos, schemas Zod e eventos (`npm run contracts:sync`). |
| `src/contracts/botao-physics.ts` | **Física compartilhada**: discos, choques, paredes, traves, chute, barreira da saída. O servidor roda a partida com ela e o front prevê o próprio botão com o mesmo código. |
| `src/botao/engine/match.ts` | Partida: comandos por tick, 2 passos de física por tick (60 Hz), gol/gol contra, comemoração, saída de bola, tempo, gol de ouro, W.O. |
| `src/botao/engine/bot.ts` | CPU: o mais perto da bola contorna, alinha com o gol e chuta; os outros ficam entre a bola e o próprio gol. |
| `src/botao/botao-rooms.service.ts` | Salas em memória (8 lugares: 0–3 vermelho, 4–7 azul), pública/privada, troca de time, prontidão, CPU por time, reconexão, anfitrião, Arena. |
| `src/botao/botao.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit. |
| `src/botao/botao-publisher.ts` | Emissão para `room:CODE`, quadros voláteis e lista pública (debounce 300 ms). |

## Regras

- Campo 840×400 (unidades do mapa clássico do HaxBall), gol de 128 com rede, traves que rebatem a bola.
- Setas/WASD (ou joystick) aceleram o botão; segurar o chute deixa o botão mais lento e chuta assim que a bola encosta (um chute por aperto).
- Gol quando a bola cruza a linha inteira dentro da boca do gol. Último toque do time que sofreu = gol contra.
- Depois do gol: 2,5 s de comemoração, todos voltam à formação e quem sofreu dá a saída. Na saída cada time fica no seu campo e quem não sai fica fora do círculo central até alguém tocar na bola.
- O anfitrião escolhe tempo (2, 3, 5 ou 10 min) e limite de gols (∞, 1, 3, 5, 7). Chegou ao limite, acaba. Fim do tempo empatado = gol de ouro.
- Time sem ninguém (todos saíram) perde por W.O. na hora.

## Rede

- Servidor a 30 Hz, cada tick roda 2 passos de física. Um quadro por tick (`botao:frame`, volátil): jogadores `[lugar, x, y, vx, vy, chute armado, lastSeq]`, bola `[x, y, vx, vy]`, placar, fase, relógio e eventos (chute, trave, apito, gol, fim).
- Cliente manda `botao:input` `{ s, d, k }` a cada tick (`d` = bits 1 cima, 2 baixo, 4 esquerda, 8 direita; `k` = chute segurado). O servidor consome um por tick (dois se o cliente estiver adiantado) e devolve `lastSeq`.
- O front prevê o próprio botão com `botao-physics` (repete os comandos ainda não confirmados sobre a posição oficial) e desenha bola e outros 60 ms no passado, interpolando.
- Gols chegam também como anúncio confiável `botao:goal` (com `seq`), usado no placar e na faixa "GOOOL!".

## Eventos (`/botao`)

Cliente → servidor (com ack): `create`, `watch_rooms`, `unwatch_rooms`, `set_visibility`, `set_stake`, `set_rules`, `join`, `sync`, `leave`, `ready`, `set_team`, `add_bot` (`team` opcional), `remove_bot`, `start`, `rematch`. Sem ack: `input`.

Servidor → cliente: `state`, `frame`, `rooms_updated`, `room_closed`, `player_joined`, `player_left`, `player_disconnected`, `player_reconnected`, `match_started`, `goal`, `match_over`.

## Arena

`BOTAO` (entrada 30, vitória +50, peso 1, mínimo 90 s para pontuar). O time campeão fica em 1º e divide o pote; o outro em 2º. Com CPU na mesa vira partida contra a CPU (sem ranking nem aposta). Migration `20261023120000_arena_botao`.

## Configuração (opcional)

- `BOTAO_RECONNECT_GRACE_MS` (padrão 30000): quanto tempo o lugar fica reservado para quem caiu.
- `BOTAO_MAX_ROOMS` (padrão 300): salas em memória (cada uma roda um loop de 30 Hz durante a partida).
