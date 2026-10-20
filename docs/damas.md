# Damas

Damas brasileiras (8x8, 12 pedras por lado) para 2 jogadores, ao vivo pelo namespace Socket.IO `/damas`.
Mesas públicas (aparecem na lista) ou privadas (só com o código), igual aos outros jogos.

## Regras implementadas

- Joga-se só nas casas escuras; a casa escura do canto inferior esquerdo fica à esquerda de cada jogador.
- Brancas saem. As cores trocam a cada revanche.
- Pedra anda 1 casa na diagonal, só para frente; captura para frente e para trás.
- Dama voa: anda e captura a distância, nas 4 diagonais, pousando em qualquer casa livre atrás da peça capturada.
- Captura obrigatória e **lei da maioria**: só valem os lances que capturam o maior número de peças (pedra e dama valem igual).
- Captura em sequência obrigatória até o fim. Peças capturadas só saem no fim do lance: bloqueiam e não podem ser puladas duas vezes.
- Pedra que passa pela última fileira no meio de uma captura e continua capturando não vira dama; vira só se o lance terminar lá.
- Vitória: o adversário fica sem peças, sem lance possível, desiste, abandona (sai ou não volta a tempo) ou estoura o tempo
  `DAMAS_MAX_TIMEOUTS` (3) vezes seguidas.
- Empate: por acordo (proposta + resposta) ou após `DAMAS_DRAW_MOVES` (20) lances de cada lado só com damas, sem captura
  e sem pedra andando (40 lances no total).

## Tempo

O anfitrião escolhe 30, 60 ou 120 s por lance (`rules.turnSeconds`). Se o tempo acaba, o servidor joga um lance válido
aleatório e conta um estouro; jogar normalmente zera a contagem.

## Servidor autoritativo

- `engine/rules.ts`: geração de lances pura (tabuleiro `Int8Array`), sem estado.
- `engine/match.ts`: uma partida (turno, contadores, propostas de empate, fim).
- `damas-rooms.service.ts`: mesas em memória, lugares, reconexão, relógio do turno, Arena.
- `damas.gateway.ts`: transporte (JWT, Zod, rate limit, deduplicação por `actionId`).

O estado público traz o tabuleiro (64 caracteres) e a lista de lances válidos de quem joga; o cliente nunca calcula
regras sozinho, só escolhe um lance da lista. Lance enviado = `{ from, path }` (casas onde a peça pousa).

## Eventos

Cliente → servidor: `damas:create | watch_rooms | unwatch_rooms | set_visibility | set_stake | set_rules | join | sync |
leave | ready | start | rematch | move | resign | offer_draw | answer_draw | emote`.

Servidor → cliente: `damas:state` (estado completo, com `version`), `rooms_updated`, `room_closed`, `emoted`, e anúncios
com `seq`: `player_joined | player_left | player_disconnected | player_reconnected | match_started | moved |
turn_timed_out | draw_offered | draw_declined | match_over`.

## Arena

`ArenaGame` `DAMAS` (migration `20261020120000_arena_damas`): entrada 30, bônus 50, peso de rating 1 (habilidade pura),
mínimo 90 s para pontuar. Vencedor = colocação 1, perdedor = 2; quem abandona paga a multa. Empates não são liquidados
(ninguém paga nem pontua), o que também impede combinar empates para farmar bônus.

## Configuração

| Variável                   | Padrão | Uso                                       |
| -------------------------- | ------ | ----------------------------------------- |
| `DAMAS_RECONNECT_GRACE_MS` | 60000  | Quanto tempo o lugar fica reservado       |
| `DAMAS_MAX_ROOMS`          | 1000   | Mesas em memória no máximo                |
