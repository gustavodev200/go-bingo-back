# Tacada

Bilhar bola 8 para 2 jogadores, ao vivo pelo namespace Socket.IO `/tacada`.
Mesas públicas (aparecem na lista) ou privadas (só com o código), igual aos outros jogos.

## Regras

- Branca + 15 bolas: lisas (1–7), listradas (9–15) e a preta (8). Triângulo com a 8 no centro e uma lisa e uma
  listrada nos cantos de trás.
- **Saída**: quem sai coloca a branca atrás da linha de saída (x ≤ 50). Encaçapou alguma bola, continua; a mesa
  segue aberta.
- **Grupos**: a mesa fecha quando alguém encaçapa uma lisa ou listrada numa tacada normal (sem falta) depois da saída.
  O primeiro grupo que cair é o dele até o fim.
- **Vez**: continua quem encaçapa ao menos uma bola do próprio grupo sem falta; senão passa a vez.
- **Faltas** (bola na mão para o adversário, em qualquer lugar livre da mesa):
  branca na caçapa (`scratch`), branca não toca nada (`no_hit`), primeira bola tocada fora do grupo ou a 8 antes da
  hora (`wrong_first`; com a mesa aberta, só a 8 é proibida), nenhuma bola na tabela nem na caçapa depois do toque
  (`no_rail`) e tempo esgotado (`timeout`).
- **Bola 8**: só depois de limpar o grupo. Encaçapá-la antes, junto com falta ou em outra caçapa que não a cantada
  é derrota.

### Regras da casa (o que muda do 8 Ball tradicional)

- **Cantar a caçapa da 8**: quem vai na 8 escolhe a caçapa antes de tacar (`pocket` 0–5). Caiu em outra, perde.
- **A 8 na saída volta**: se a 8 cair na saída ela volta para o ponto do pé (ninguém ganha nem perde).
- **3 faltas seguidas perdem**: `TACADA_MAX_FOULS` faltas seguidas do mesmo jogador (tempo esgotado conta) é derrota.
- **Relógio da tacada**: 20, 30 ou 45 s (`rules.shotSeconds`), contados depois que as bolas param.
- **Mira**: o anfitrião escolhe mira longa (mostra o caminho da bola atingida e da branca) ou curta (só a bola
  fantasma) — `rules.aimGuide`.
- **Revanche alterna a saída.**

## Servidor autoritativo com física compartilhada

- `src/contracts/tacada-physics.ts`: física pura e **determinística** (passo fixo de 1/480 s; só `+ − × ÷ √`, sem
  trigonometria, então dá o mesmo resultado no Node, Chrome e Safari). Vai para o front pelo `contracts:sync`.
- `engine/match.ts`: uma partida — roda a física da tacada e aplica as regras (faltas, grupos, vez, 8, fim).
- `tacada-rooms.service.ts`: mesas em memória, lugares, reconexão, relógio, Arena.
- `tacada.gateway.ts`: transporte (JWT, Zod, rate limit, deduplicação por `actionId`, repasse da mira).

Fluxo de uma tacada: o cliente manda `tacada:shoot { dirX, dirY, power, spinX, spinY, cueX?, cueY?, pocket? }`. O
servidor simula até tudo parar, decide e manda `tacada:shot { shot: { ...tacada, start }, result }` + o estado com as
posições finais (arredondadas em 3 casas). O cliente reproduz a mesma simulação a partir de `start` para animar e no fim
assume as posições do estado. `game.readyAt` = fim da animação: antes disso o servidor recusa outra tacada e o relógio
só começa depois.

A mira ao vivo (`tacada:aim`, até 20/s, sem confirmação) só é aceita de quem joga e é repassada aos outros como
`tacada:aimed` (volátil: pode se perder sem problema).

## Eventos

Cliente → servidor: `tacada:create | watch_rooms | unwatch_rooms | set_visibility | set_stake | set_rules | join |
sync | leave | ready | start | rematch | aim | shoot | resign | emote`.

Servidor → cliente: `tacada:state` (estado completo, com `version`), `rooms_updated`, `room_closed`, `emoted`,
`aimed`, e anúncios com `seq`: `player_joined | player_left | player_disconnected | player_reconnected |
match_started | shot | turn_timed_out | match_over`.

## Arena

`ArenaGame` `TACADA` (migration `20261020220000_arena_tacada`): entrada 30, bônus 50, peso de rating 0.9, mínimo 90 s
para pontuar. Vencedor = colocação 1, perdedor = 2; quem abandona paga a multa. Bilhar não tem empate.

## Configuração

| Variável                    | Padrão | Uso                                 |
| --------------------------- | ------ | ----------------------------------- |
| `TACADA_RECONNECT_GRACE_MS` | 60000  | Quanto tempo o lugar fica reservado |
| `TACADA_MAX_ROOMS`          | 1000   | Mesas em memória no máximo          |
