# Blackjack

Torneio de Blackjack (21) para 1 a 5 jogadores contra o dealer da casa, ao vivo pelo namespace Socket.IO `/blackjack`.
Mesas públicas (aparecem na lista) ou privadas (só com o código), igual aos outros jogos.

## Formato: torneio de fichas

- Todo mundo começa com `BJ_START_CHIPS` (1000) fichas da mesa. Elas só valem dentro da partida.
- A partida tem `rules.rounds` rodadas (5, 10 ou 15). No fim, a colocação é pelas fichas: quem tiver mais fica em 1º;
  empates dividem a colocação. Quem fica sem fichas para a aposta mínima assiste até o fim (colocação pelas fichas, 0).
- Sozinho é **treino** contra o dealer: nada vai para a Arena. Com 2 ou mais, o resultado liquida na Arena.
- Assim todos jogam contra o dealer, mas a disputa é entre os jogadores: quem administra melhor a banca vence.

## Rodada

1. **Aposta** (`BJ_BET_SECONDS`, 20 s): de 10 a 500, em múltiplos de 10, até o que você tem. Acabou o tempo, entra a mínima.
   Quando todo mundo apostou, as cartas saem na hora.
2. **Distribuição**: duas cartas abertas para cada jogador; o dealer recebe uma aberta e uma **virada para baixo**
   (estilo Atlantic City). A escondida só aparece no estado público quando o dealer joga.
3. **Seguro** (`BJ_INSURANCE_SECONDS`, 10 s): se o dealer mostra um Ás, cada um decide se aposta metade da aposta no
   blackjack do dealer. Paga 2:1. Sem fichas para o seguro = não oferecido.
4. **Espiada**: com Ás ou figura/10 à mostra, o dealer confere o blackjack antes de alguém jogar. Se tiver, a rodada
   acaba: blackjack do jogador empata, o resto perde (só a aposta original).
5. **Decisões** (`rules.turnSeconds`, 15 ou 30 s por decisão), em ordem de lugar e de mão. Acabou o tempo, a mão para.
6. **Dealer**: vira a escondida e compra até 17; **para em todo 17** (inclusive 17 mole). Se todas as mãos estouraram,
   renderam ou são blackjack, ele não compra.
7. **Pagamento** e pausa (`BJ_SETTLE_PAUSE_MS` + `BJ_DEALER_CARD_MS` por carta que o dealer comprou) antes da próxima rodada.

## Jogadas

| Jogada | Quando | Efeito |
|---|---|---|
| Pedir (hit) | mão em jogo | +1 carta. Passou de 21 estoura; 21 para sozinha |
| Parar (stand) | mão em jogo | encerra a mão |
| Dobrar (double) | duas primeiras cartas (também depois de dividir), com fichas | aposta dobra, recebe **uma** carta e para |
| Dividir (split) | duas primeiras cartas de mesmo valor (K e 10 valem), uma vez só, com fichas | duas mãos com a mesma aposta; ases recebem uma carta cada e param; 21 numa mão dividida não é blackjack |
| Render (surrender) | duas primeiras cartas, sem ter dividido, **só no sapato de 6 baralhos** | devolve metade da aposta |

Pagamentos: vitória 1:1, blackjack 3:2 ou 6:5 (`rules.payout`), empate devolve a aposta, seguro 2:1. Apostas são
múltiplos de 10, então todo pagamento é inteiro.

## Sapato

`rules.decks` = 2 (Double Deck, sem render) ou 6. Embaralhado com `crypto.randomInt` (Fisher–Yates). Entre rodadas,
quando sobra menos de `BJ_RESHUFFLE_AT` (25%), o sapato é refeito (`blackjack:shuffled`). Se acabar no meio de uma
rodada, ele é refeito sem as cartas que estão na mesa.

## Servidor autoritativo

- `engine/shoe.ts`: sapato.
- `engine/match.ts`: o torneio inteiro (rodadas, etapas, jogadas, pagamentos, colocação). Puro, sem relógio: expõe
  `turnToken` (muda quando o relógio deve reiniciar) e `stageMs` (quanto dura a etapa atual); `timeout()` aplica o padrão.
- `blackjack-rooms.service.ts`: mesas em memória, lugares, reconexão, relógio da etapa, Arena.
- `blackjack.gateway.ts`: transporte (JWT, Zod, rate limit, deduplicação por `actionId`).

O estado público traz tudo o que está na mesa e a lista de jogadas válidas da mão da vez (`game.actions`); o cliente
só escolhe uma jogada da lista. O que está no sapato nunca sai do servidor.

## Eventos

Cliente → servidor: `blackjack:create | watch_rooms | unwatch_rooms | set_visibility | set_stake | set_rules | join |
sync | leave | ready | start | rematch | bet | insurance | act | emote`.

Servidor → cliente: `blackjack:state` (estado completo, com `version`), `rooms_updated`, `room_closed`, `emoted`, e
anúncios com `seq`: `player_joined | player_left | player_disconnected | player_reconnected | match_started |
round_started | shuffled | dealt | acted | dealer_played | round_settled | player_broke | match_over`.

## Saídas e reconexão

O lugar fica reservado por `BLACKJACK_RECONNECT_GRACE_MS`; o relógio continua (apostas mínimas e "parar" automáticos).
Quem sai (ou não volta) perde o que estava apostado e fica em último. Se numa partida de 2+ sobrar só um jogador, a
partida acaba (`abandoned`) e as apostas da rodada em andamento voltam para quem ficou.

## Arena

`ArenaGame` `BLACKJACK` (migration `20261020180000_arena_blackjack`): entrada 30, bônus de vitória 40, peso de rating
0.5 (as cartas pesam muito), mínimo 60 s para pontuar. Colocação = posição pelas fichas; com 4+ jogadores o pote
divide 60/30/10. Todo mundo empatado no topo não é liquidado (ninguém venceu). Quem sai paga a multa de abandono.

## Configuração

| Variável                       | Padrão | Uso                                 |
| ------------------------------ | ------ | ----------------------------------- |
| `BLACKJACK_RECONNECT_GRACE_MS` | 60000  | Quanto tempo o lugar fica reservado |
| `BLACKJACK_MAX_ROOMS`          | 1000   | Mesas em memória no máximo          |
