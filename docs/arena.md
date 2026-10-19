# Arena — moedas e ranking únicos para todos os jogos

Antes só o bingo pagava moedas e pontos. Agora **todo jogo** (bingo, UNO, truco, dominó, Snake.io, Bomber) liquida
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
mantém a régua justa entre jogos: bingo 0.5 (sorte), UNO/dominó 0.8, truco/bomber 1.0, Snake 0.35 por abate.
Vencer rende no mínimo +4×peso; sequência soma +1 ponto por vitória seguida (até 5). Pontos nunca ficam negativos (CHECK no banco).

**Ligas.** Bronze 0, Prata 150, Ouro 400, Platina 800, Diamante 1500, Lenda 3000.

**Ranking semanal.** Soma de `MatchResult.pointsDelta` desde a segunda 00:00 (São Paulo). Top 3 com ≥5 partidas pontuadas
na semana ganha 1000/500/250 moedas ao fechar.

**Snake.** Não tem "fim de partida": cada abate entre dois jogadores é um duelo. O abatido paga a entrada (10) ao
matador e o rating anda com peso baixo. Não mexe na sequência. Suicídio (borda/corpo próprio) não conta.

## Anti-abuso (fairness)

- Só pontua entre jogadores **logados**; convidados jogam e movem moedas, mas sem pontos nem bônus de progressão.
- Partida mais curta que `minRatedMs` do jogo não pontua nem rende bônus.
- **Retorno decrescente por par**: mesmo adversário nas últimas 24 h — 3 partidas cheias, até 8 pela metade, depois zero
  (afeta pontos e bônus dos dois lados, simétrico).
- **Abandono** = derrota na última colocação + multa (a entrada de novo, que vai para o pote de quem ficou) + sem bônus.
- **CPU** (Bomber) não entra: mesa com 1 humano não liquida.
- Liquidação idempotente e em fila (uma de cada vez): sem pagamento duplicado, sem esgotar conexões.

## Banco

Migration `20261019000000_arena`: `Profile` ganha `streak`, `bestStreak`, `ratedMatches`, `bestTier`, `lastWinBonusOn`;
tabelas `MatchResult` e `SeasonPayout` (RLS ligada); `CoinReason` ganha `STAKE`, `PRIZE`, `BONUS`, `PENALTY`, `TIER`, `SEASON`;
`CHECK (points >= 0)`. Perfis existentes já nascem com `bestTier` coerente (sem bônus retroativo).
