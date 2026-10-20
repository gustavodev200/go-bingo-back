# Truco Gaudério / Argentino — multiplayer em tempo real

Truco com baralho espanhol, mano a mano (2) ou em duplas (4), com Envido e Flor.
Mesmo desenho do truco mineiro: namespace Socket.IO `/gauderio` no servidor NestJS,
autoridade única no servidor, estado em memória.

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/gauderio.ts` | Tipos, schemas Zod, eventos, força das cartas, pontos de envido/flor (sincronizado para o front). |
| `src/gauderio/engine/match.ts` | Regras puras: rodadas, empates, truco, envido, flor, carta escondida, ir ao baralho, W.O. |
| `src/gauderio/gauderio-rooms.service.ts` | Mesas, lugares, prontidão, regras da mesa, reconexão, anfitrião, Arena. |
| `src/gauderio/gauderio.gateway.ts` | Auth JWT, Zod, rate limit, dedupe por `actionId`. |

## Regras implementadas

- 40 cartas (sem 8, 9 e coringas), 3 por jogador. Força: 1♠ > 1 de paus > 7♠ > 7 de ouros >
  3 > 2 > 1 (copas/ouros) > 12 > 11 > 10 > 7 (paus/copas) > 6 > 5 > 4. Comuns iguais empatam.
- Mesa configurada pelo anfitrião no lobby: 2 ou 4 jogadores, partida até 12 ou 24, flor ligada ou não.
  Duplas: lugares 1+3 contra 2+4.
- Mão em melhor de 3 rodadas. Empates: empata a 1ª → a 2ª decide; empata a 2ª ou a 3ª → vale a 1ª;
  empata 1ª e 2ª → a 3ª decide; três empates → vence a dupla do mão. Quem ganha a rodada começa a próxima.
- Carta escondida (da 2ª rodada em diante) não vale nada. Ir ao baralho (na sua vez) entrega o valor atual da mão.
- **Truco** 2 → **Retruco** 3 → **Vale 4** 4, pedido na própria vez. Só a dupla que aceitou pode aumentar.
  Não quero entrega o valor anterior (1, 2 ou 3).
- **Envido** (só na 1ª rodada, antes de jogar sua carta, e só com truco ainda não aceito; com 4 jogadores
  só os dois últimos da rodada pedem). Pode responder a um primeiro "truco" ("o envido vem primeiro"): o
  truco fica esperando e volta depois do envido.
  Valores aceitos somam: Envido 2 (pode repetir uma vez), Real Envido 3, Falta Envido = falta
  (alvo − pontos de quem está ganhando). Não quero dá 1 no primeiro canto, ou a soma dos cantos anteriores
  (envido → real → não quero = 2; envido + real → falta → não quero = 5).
  Pontos: 20 + duas cartas do mesmo naipe (figuras valem 0); sem naipe repetido, a maior carta.
  Empate fica com quem está mais perto do mão. Os pontos entram na hora.
- **Flor** (três do mesmo naipe): obrigatória — o servidor não deixa jogar a primeira carta antes de cantar.
  Anula o envido. Sem flor do outro lado: +3. Com flor do outro lado, a outra dupla responde
  Contra-flor (6 para a maior flor, 20 + as três cartas), Contra-flor e o resto (a falta) ou foge (+4 para quem cantou;
  fugir da contra-flor e o resto depois de uma contra-flor dá 6).
- Ganha quem chegar ao alvo (placar limitado ao alvo; a partida acaba na hora, até no meio da mão).
- Resposta a qualquer canto: o primeiro jogador da dupla adversária que responder decide.

Valores escolhidos onde o regulamento colado era ambíguo: Real Envido sozinho vale 3 (padrão argentino;
só envido + real envido vale 5).

Arena: jogo `GAUDERIO` (ante 40, vitória 60, peso 1, mínimo 90 s). Migração
`20261021000000_arena_gauderio` escrita à mão, ainda não aplicada em banco real.

## Eventos (`/gauderio`)

Cliente → servidor (ack `{ ok, data } | { ok: false, error }`): `create {isPublic, settings}`, `watch_rooms`,
`unwatch_rooms`, `set_visibility`, `set_stake`, `set_settings {settings}`, `join {code}`, `leave`,
`take_seat {seat}`, `ready {ready}`, `start`, `rematch`, `sync`, e as jogadas com `actionId`:
`play_card {cardId, hidden}`, `call {call}`, `respond {accept}`, `fold`.

Servidor → cliente: `state` (público), `private_hand` (só para o dono: cartas, pontos de envido, flor e as
ações possíveis agora), e anúncios com `seq`: `hand_dealt`, `card_played`, `round_ended`, `called`,
`responded`, `side_resolved`, `folded`, `hand_ended`, `score_updated`, `match_over`, entrada/saída/queda.

Variáveis opcionais: `GAUDERIO_RECONNECT_GRACE_MS` (60000), `GAUDERIO_HAND_PAUSE_MS` (2500),
`GAUDERIO_MAX_ROOMS` (1000).
