# Truco do Gu — multiplayer em tempo real

Truco Mineiro 2 contra 2, exclusivamente entre 4 humanos, sobre Socket.IO no
mesmo servidor NestJS do Bingo (namespace `/truco`, sem infraestrutura nova).

## Arquitetura

```
front (Next)                         back (NestJS)
features/truco ──socket.io /truco──▶ TrucoGateway        auth JWT, Zod, rate limit, dedupe por actionId
  store (zustand, version/seq)         │
  reactions (grito, som, voz)          ▼
                                     TrucoRoomsService   autoridade única: salas, assentos, presença, timers
                                       │
                                       ▼
                                     TrucoMatch (engine) regras puras do Truco Mineiro, sem transporte
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/truco.ts` | Tipos, schemas Zod e nomes de eventos (copiado para o front por `npm run contracts:sync`). |
| `src/truco/engine/cards.ts` | Baralho de 40 cartas, embaralhamento (Fisher–Yates com `crypto.randomInt`), força das cartas. |
| `src/truco/engine/match.ts` | Mãos, rodadas, empates, apostas, mão de dez, mão de ferro, W.O. |
| `src/truco/truco-rooms.service.ts` | Salas em memória, lugares, prontidão, início, reconexão, anfitrião, publicação. |
| `src/truco/truco.gateway.ts` | Handlers Socket.IO: autenticação, validação, rate limit, deduplicação. |
| `src/truco/truco-publisher.ts` | Emissão para o canal da sala (`room:CODE`) e do usuário (`user:ID`). |

## Regras implementadas

- 40 cartas (sem 8, 9, 10 e coringas), 3 cartas por jogador, distribuição só no servidor.
- Manilhas fixas: Zap (4♣) > Copeta (7♥) > Espadilha (A♠) > Pica-fumo (7♦); depois
  3 > 2 > A > K > J > Q > 7 > 6 > 5 > 4. Cartas comuns iguais empatam (sem naipe).
- Duplas: lugares 0+2 contra 1+3. A vez gira para o próximo lugar; quem dá as cartas roda a cada mão.
- Rodadas: quem joga a maior carta começa a próxima. Empate entre parceiros = rodada da dupla.
  Empate entre duplas: quem jogou primeiro a carta empatada começa a próxima.
- Mão: duas rodadas vencem. Com empate, vence a primeira rodada decidida
  (empata 1ª → 2ª decide; ganha 1ª e empata 2ª/3ª → vence quem ganhou a 1ª).
  Três empates: mão anulada, ninguém pontua.
- Mão normal vale 1. Apostas 1 → 3 (truco) → 6 → 9 → 12, pedidas na própria vez. A dupla adversária aceita,
  corre ou aumenta; a mesma dupla não aumenta duas vezes seguidas. Correr dá à dupla que
  fez o último pedido o valor anterior da mão.
- Modo escolhido pelo anfitrião (na criação ou no lobby; `TRUCO_RULES` nos contratos):
  - **Mineiro** (padrão): partida até 12. Mão de dez (uma dupla com 10): a dupla vê as cartas do
    parceiro e decide; jogando vale 4, correndo os adversários ganham 2. Sem truco.
    Mão de ferro (10 a 10): cartas ocultas até serem jogadas (nem o dono vê), vale 1, sem truco.
  - **Goiano**: partida até 15. Mão de 14 (uma dupla com 14): a dupla vê as cartas do parceiro e
    decide; jogando vale 3, correndo os adversários ganham só 1. Sem truco. No 14 a 14 não há
    mão de ferro: mão normal, cada um vê só as próprias cartas.

Não implementado (variações para o futuro): vira do Paulista, carta encoberta, limite de tempo por jogada.

## Eventos (`/truco`)

Cliente → servidor (todos com ack `{ ok, data } | { ok: false, error }`):

| Evento | Payload |
|---|---|
| `truco:create` | `{ isPublic?, mode? }` (padrão pública, `mineiro`) → snapshot |
| `truco:watch_rooms` | `{}` → mesas públicas; passa a receber `truco:rooms_updated` |
| `truco:unwatch_rooms` | `{}` |
| `truco:set_visibility` | `{ isPublic }` (só o anfitrião) |
| `truco:set_mode` | `{ mode: 'mineiro' \| 'goiano' }` (só o anfitrião, no lobby; desmarca "pronto") |
| `truco:join` | `{ code }` → snapshot (também é a reconexão) |
| `truco:sync` | `{}` → snapshot |
| `truco:leave` | `{}` |
| `truco:take_seat` | `{ seat }` (só no lobby) |
| `truco:ready` | `{ ready }` |
| `truco:start` | `{}` (anfitrião, 4 conectados e prontos) |
| `truco:play_card` | `{ actionId, cardId }` |
| `truco:request_bet` | `{ actionId }` |
| `truco:respond_bet` | `{ actionId, response: 'accept' \| 'run' \| 'raise' }` |
| `truco:ten_decision` | `{ actionId, play }` |
| `truco:signal` | `{ gesture }` |
| `truco:rematch` | `{}` |

Servidor → cliente: `truco:state` (estado público, com `version`), `truco:private_hand`
(só para o dono), `truco:player_joined`, `truco:player_left`, `truco:player_disconnected`,
`truco:player_reconnected`, `truco:match_started`, `truco:hand_dealt`, `truco:card_played`,
`truco:round_ended`, `truco:hand_ended`, `truco:bet_requested`, `truco:bet_resolved`,
`truco:ten_decided`, `truco:score_updated`, `truco:match_over`, `truco:signal_received`
(só o parceiro), `truco:gestured` (só os adversários, sem o gesto), `truco:room_closed`,
`truco:rooms_updated` (lista de mesas públicas, só para quem está no lobby observando).

Mesas públicas aparecem na lista enquanto não estão em partida e têm lugar vago; privadas só
entram pelo código. A lista é reenviada com debounce de 300 ms a cada mudança.

Todo anúncio leva `seq` crescente por sala: o cliente descarta duplicados, então grito, som e
voz tocam uma vez só. O estado leva `version`; o cliente ignora versões antigas.

## Segurança e privacidade

- Identidade = `sub` do JWT do Supabase verificado no handshake; nome e personagem vêm do perfil
  salvo e nunca servem de prova de identidade. Sem apelido, não senta à mesa.
- O cliente nunca informa assento, dupla, pontuação, vencedor ou destinatário: tudo é derivado no servidor.
- Estado público não contém cartas em mão (só a contagem). Cada mão vai para o canal do próprio
  usuário. Na mão de ferro nem o dono recebe as cartas; os ids das cartas não codificam a carta.
- Sinais: o servidor resolve o parceiro pelo assento e envia o gesto só a ele. Adversários
  recebem apenas `{ seat }` (viram uma careta, não qual). O significado é uma convenção salva
  no aparelho de cada jogador e nunca trafega. O gesto não é logado.
- Rate limit por socket: 10 ações/s, 3 criações/10 s, 1 sinal/s. Ações de jogo levam `actionId`:
  repetir o mesmo id devolve a resposta original sem executar de novo.
- Todo payload é validado com Zod; eventos fora do estado permitido são rejeitados.

## Reconexão, abandono e encerramento

- Um usuário ocupa no máximo uma mesa e um lugar; entrar de novo (outra aba, queda) devolve o mesmo lugar.
- Ao cair o último socket do usuário, o lugar fica reservado por `TRUCO_RECONNECT_GRACE_MS`
  (padrão 60 s). Os outros veem "Reconectando" com contagem regressiva. Ninguém ocupa o lugar
  reservado e a partida não é redistribuída nem reiniciada.
- Reconectou dentro do prazo: recebe snapshot com o mesmo lugar, as mesmas cartas e o estado atual.
- Prazo expirou: no lobby ou após a partida, o lugar é liberado; durante a partida, a dupla
  ausente perde por W.O. Sair durante a partida também é W.O. imediato.
- Anfitrião offline ou fora da mesa: o papel passa a um jogador conectado.
- A mesa é apagada quando o último jogador sai. "Jogar de novo" volta ao lobby com os mesmos lugares.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `TRUCO_RECONNECT_GRACE_MS` | 60000 | Janela de reconexão. |
| `TRUCO_HAND_PAUSE_MS` | 2500 | Pausa entre o fim de uma mão e a próxima distribuição. |
| `TRUCO_MAX_ROOMS` | 1000 | Limite de mesas em memória. |

## Limitações conhecidas (primeira versão)

- **Estado só em memória.** Reiniciar ou fazer deploy do backend encerra todas as mesas em andamento;
  os clientes caem em "Mesa não encontrada". Não há persistência nem recuperação após falha.
- **Uma instância.** As mesas vivem no processo que as criou. Com mais de uma instância seria preciso
  sticky sessions + estado compartilhado (ex.: Redis com `@socket.io/redis-adapter` e as mesas fora
  da memória local). Hoje a aplicação roda em uma instância, então isso não foi adicionado.
- Sem limite de tempo por jogada: um jogador conectado e parado trava a mesa até alguém sair.
- Partidas de truco não geram pontos de ranking nem moedas.
- Contas anônimas do Supabase podem criar várias mesas (uma por conta); o teto `TRUCO_MAX_ROOMS`
  e o rate limit de criação limitam o abuso.

## Testes

- `src/truco/engine/*.spec.ts`: baralho, hierarquia, manilhas, empates, apostas, mão de dez/ferro, W.O.
- `src/truco/truco-rooms.service.spec.ts`: salas, quinto jogador, início, duplas, privacidade, seq/version,
  placar, 12 tentos, sinais, reconexão, expiração, anfitrião.
- `src/truco/truco.gateway.spec.ts`: integração com Nest real e 4 clientes `socket.io-client`
  (sem banco: verificador JWT e perfis são stubs).

Rodam com `npm test`, sem Postgres.
