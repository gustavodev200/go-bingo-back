# Arena — moedas e ranking únicos para todos os jogos

Antes só o bingo pagava moedas e pontos. Agora **todo jogo** liquida
pela mesma regra: uma carteira, um ranking, as mesmas ligas, e cada disputa tem algo em jogo.

```
jogo em memória (uno/truco/domino/bomber)        bingo (claim)            snake (abate)
  MatchTracker: quem sentou, quem saiu             mesma transação          1 abate = 1 duelo
        │                                               │                        │
        └──────────────► ArenaService.settle / settleIn ◄────────────────────────┘
                              │  planSettlement (puro): rating, bônus, pote
                              ▼
        Profile (coins, points, streak, bestTier…) + CoinTransaction + MatchResult
```

| Arquivo | Responsabilidade |
|---|---|
| `src/contracts/arena.ts` | Regras e constantes (entrada, bônus, pesos, ligas, prêmios) + schema do resultado. Sincroniza com o front. |
| `src/arena/settlement.ts` | **Funções puras**: rating Elo, bônus, divisão do pote, anti-abuso. Tudo testado sem banco. |
| `src/arena/arena.service.ts` | Aplica o plano numa transação: cobra entradas, paga o pote, bônus, liga; grava `MatchResult`. Idempotente por `(matchId, userId)`. `settleSafe` enfileira e nunca derruba a partida. |
| `src/arena/match-tracker.ts` | Acompanha uma partida dos jogos em memória (assentos, quem saiu, duração). |
| `src/arena/season.service.ts` | Prêmio semanal (cron segunda 00:10 SP + recuperação no boot). Idempotente por `(semana, posição)`. |
| `src/arena/arena.controller.ts` | `GET /arena/latest[?since]` → `{ result, now }`: a tela de fim de partida busca o extrato aqui. |
| `src/ranking/ranking.service.ts` | `GET /ranking?scope=all\|week`. |

## Regras

**Moedas — o pote.** Cada jogador paga a entrada do jogo (`ARENA_RULES[game].ante`). Só entra no pote o que foi
cobrado de verdade (saldo nunca fica negativo), então perdedor sem saldo não "cria" moedas para o vencedor.
O pote vai para quem ficou no topo (dupla vencedora divide). Com 4+ jogadores e 3+ colocações: 60/30/10.
Por cima, a casa paga **bônus**:

| Bônus | Quando |
|---|---|
| Partida concluída | todo mundo que ficou até o fim (exceto Snake) |
| Vitória | vencedor (`winBonus` do jogo; bingo em quina vale metade) |
| Sequência | +10 moedas por vitória seguida além da 1ª (até 5) |
| Primeira vitória do dia | +40 (fuso São Paulo) |
| Quem era mais forte | venceu adversário com rating médio ≥150 acima |
| Virada | venceu depois de 3 derrotas seguidas |
| Subir de liga | uma vez por liga (Prata 100 … Lenda 2500), guardado em `Profile.bestTier` |

**Pontos — rating Elo.** `points` + 1000 forma a escala. Para cada adversário logado: ganho = `K × peso × (resultado − esperado)`,
médio pelos adversários. `K` = 40 (10 primeiras), 28 (até 50), 20 depois: novatos se acomodam rápido. O **peso do jogo**
mantém a régua justa entre jogos: bingo e blackjack 0.5 (sorte), UNO/dominó 0.8, truco/bomber 1.0, Snake 0.35 por abate.
Vencer rende no mínimo +4×peso; sequência soma +1 ponto por vitória seguida (até 5). Pontos nunca ficam negativos (CHECK no banco).

**Ligas.** Bronze 0, Prata 150, Ouro 400, Platina 800, Diamante 1500, Lenda 3000.

**Ranking semanal.** Soma de `MatchResult.pointsDelta` desde a segunda 00:00 (São Paulo). Top 3 com ≥5 partidas pontuadas
na semana ganha 1000/500/250 moedas ao fechar.

**Snake.** Não tem "fim de partida": cada abate entre dois jogadores é um duelo. O abatido paga a entrada (10) ao
matador e o rating anda com peso baixo. Não mexe na sequência. Suicídio (borda/corpo próprio) não conta.

## Mesas com aposta

O anfitrião escolhe no lobby quanto a mesa vale (`<jogo>:set_stake`; no bingo, ao criar a sala). Os valores são
múltiplos da entrada mínima do jogo (`ARENA_RULES[game].ante`), em `STAKE_LEVELS`:

| Nível | × mínimo | Liga exigida | Taxa da casa |
|---|---|---|---|
| Amistosa | 1× | — | 0 |
| Valendo | 2× | — | 0 |
| Alta | 5× | Prata | 5% do pote |
| High Roller | 10× | Ouro | 5% do pote |
| VIP | 25× | Platina | 5% do pote |

- **Saldo checado antes**: entrar na mesa, mudar a aposta (o anfitrião) e iniciar pedem que cada humano cubra a aposta
  (`ArenaService.assertStake` → `INSUFFICIENT_COINS`/`STAKE_LOCKED`, com o apelido de quem falta). A cobrança de verdade
  continua na liquidação (`chargeUpTo`): se alguém gastar o saldo em outra mesa no meio, entra no pote só o que tinha.
- Mudar a aposta tira o "pronto" de todo mundo: ninguém começa sem ver o valor novo.
- A multa de abandono é a aposta da mesa (não a mínima).
- **Bônus e pontos não mudam com a aposta**: o ranking mede habilidade, não saldo. A taxa das mesas altas tira moedas
  de circulação e equilibra os diamantes.
- Mesa com CPU não aposta: nada é checado nem cobrado (ver *Partidas contra a CPU*).
- **Bingo**: a primeira cartela é o "sentar": pede aposta + cartela. A cartela automática do início continua sem travar
  a partida (quem não tem saldo joga e paga até zerar).
- **Snake** não tem lobby (arena contínua): continua no valor mínimo por abate.

## Partidas contra a CPU

Todo jogo aceita CPU, para quem quer treinar ou está sozinho. O anfitrião chama a CPU no lobby
(`<jogo>:add_bot` / `<jogo>:remove_bot`; no bingo `room:set_cpus { count }`, até 3 cartelas). No Snake.io
as cobras da CPU aparecem sozinhas enquanto há pouca gente online (completam até `SNAKE_CPU_FILL` cobras).

| Regra | Valor |
|---|---|
| Ranking | não conta (`rated: false`, `pointsDelta: 0`, sequência intacta) |
| Entrada / aposta / multa | nenhuma (mesa com CPU ignora a aposta escolhida) |
| Vitória (colocação 1) | `CPU_WIN_COINS` = 10 moedas |
| Derrota / empate | `CPU_PLAY_COINS` = 5 moedas |
| Abandono, convidado, partida < `CPU_MIN_MS` (30 s) | 0 |
| Teto | `CPU_DAILY_CAP` = 30 partidas pagas por dia (fuso São Paulo) |

- Basta **uma** CPU na mesa para a partida inteira ser "contra a CPU", mesmo com várias pessoas (assim ninguém
  usa a CPU para inflar o ranking de um amigo).
- `MatchTracker(humanos, início, cpuPlayers)` → `settleSafe({ ..., cpuPlayers })` → `ArenaService.settleCpuIn`.
  O resultado leva `bonuses: [{ code: 'CPU', amount }]` (sempre, mesmo zerado: é o que conta no teto do dia) e
  `vsCpu: true`.
- Snake.io: derrubar uma CPU = vitória, cair para uma CPU = derrota (vida de pelo menos 30 s).
- Bingo: as cartelas da CPU são linhas de `Card` com ids fixos (`BINGO_CPU_IDS`); a CPU grita bingo no sorteio
  seguinte ao que completou a cartela, se ninguém gritou antes.
- As CPUs (`src/<jogo>/engine/bot.ts`) só usam o que o próprio lugar enxerga (mão privada + estado público):
  nunca espiam cartas dos outros. Damas usa alfa-beta de 3 lances, Tacada simula as tacadas com a mesma física
  da mesa (com erro de mira), Blackjack segue a estratégia básica.

Migration `20261021120000_bingo_cpu`: `Room.cpuPlayers` (0 a 3).

## Diamantes

Moeda premium (`src/contracts/diamonds.ts`, `src/diamonds/`). Só contas logadas: convidado descartável não farma
diamantes para passar moedas a outra conta.

- `POST /diamonds/claim`: 10 💎 por dia (calendário de São Paulo), resgate manual. Dias seguidos formam um ciclo de 7;
  o 7º dia paga +15. Pulou um dia, o ciclo recomeça. UPDATE condicional: nunca paga duas vezes no mesmo dia.
- `POST /diamonds/exchange { diamonds }`: pacotes 1 → 50, 10 → 550 (+10%), 50 → 3000 (+20%) moedas.
- `GET /diamonds`: saldo, dia do ciclo, se já resgatou hoje e quanto o próximo resgate paga.
- Ranking semanal também paga 30/20/10 💎 ao top 3 (`SeasonPayout.diamonds`).
- Extrato em `DiamondTransaction` (`DAILY`, `STREAK`, `EXCHANGE`, `SEASON`); a troca grava também `CoinTransaction`
  `EXCHANGE`. `CHECK (diamonds >= 0)`.

## Anti-abuso (fairness)

- Só pontua entre jogadores **logados**; convidados jogam e movem moedas, mas sem pontos nem bônus de progressão.
- Partida mais curta que `minRatedMs` do jogo não pontua nem rende bônus.
- **Retorno decrescente por par**: mesmo adversário nas últimas 24 h — 3 partidas cheias, até 8 pela metade, depois zero
  (afeta pontos e bônus dos dois lados, simétrico).
- **Abandono** = derrota na última colocação + multa (a entrada de novo, que vai para o pote de quem ficou) + sem bônus.
- **CPU** nunca pontua: partida com CPU na mesa vira *partida contra a CPU* (abaixo).
- Liquidação idempotente e em fila (uma de cada vez): sem pagamento duplicado, sem esgotar conexões.

## Banco

Migration `20261020000000_stakes_diamonds`: `Profile.diamonds/diamondStreak/lastDiamondOn`, `Room.stake`,
`SeasonPayout.diamonds`, tabela `DiamondTransaction` (RLS ligada), `CoinReason.EXCHANGE`.

Migration `20261019000000_arena`: `Profile` ganha `streak`, `bestStreak`, `ratedMatches`, `bestTier`, `lastWinBonusOn`;
tabelas `MatchResult` e `SeasonPayout` (RLS ligada); `CoinReason` ganha `STAKE`, `PRIZE`, `BONUS`, `PENALTY`, `TIER`, `SEASON`;
`CHECK (points >= 0)`. Perfis existentes já nascem com `bestTier` coerente (sem bônus retroativo).
