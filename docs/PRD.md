# PRD — Go Bingo v2 (Bingo 3D multiplayer, PWA)

| Campo | Valor |
|---|---|
| Autor | Gustavo Lage |
| Status | Draft |
| Última atualização | 2026-10-05 (auth: Google + convidado) |
| Complexidade | Tier 3 — iniciativa grande (produto novo, realtime + 3D + PWA) |
| Repositórios | `go-bingo-front` (Next.js + React Three Fiber, PWA) · `go-bingo-back` (NestJS + Socket.IO + Prisma) |
| Base | Reescrita do Collab Bingo v1 (Express/EJS/Socket.IO/Knex). PRD da v1 = engenharia reversa, usado como insumo. |

> Este PRD é o insumo do `/speckit-specify`. Cada épico da seção 3 vira uma feature `specs/NNN-slug/` no repositório correspondente.

---

## 1. Visão geral

### 1.1 Problema

O Collab Bingo v1 funciona como jogo, mas:

- **Não é confiável:** vitória e pontuação são decididas pelo cliente (qualquer pessoa pontua qualquer id), a API não tem autenticação e o segredo JWT está no repositório.
- **Não aguenta falhas:** o estado da partida fica em memória e some se o servidor reinicia. Quem cai da conexão perde as pedras marcadas.
- **A experiência é rasa:** telas EJS estáticas, sem identidade visual marcante, sem suporte decente a mobile e sem instalação.

### 1.2 Solução proposta

Reescrever o jogo como **bingo multiplayer em um ambiente 3D**, instalável como PWA, com o servidor como única fonte da verdade:

- **Lobby 3D:** ao entrar na sala, cada jogador aparece como um boneco (avatar low-poly) entrando numa fila/plateia. Quem entra ou sai é visto ao vivo.
- **Partida 3D:** um palco com **globo de bingo e telão** mostra a bola sorteada, as últimas bolas e o painel geral de números. Cada jogador vê a própria cartela e acompanha os outros (avatares reagindo quando alguém fica a 1 pedra, ou quando sai um bingo).
- **Servidor autoritativo:** NestJS sorteia, persiste cada número, valida o "Bingo!" contra a cartela e os números sorteados, e atribui os pontos.
- **Mobile de verdade:** o 3D é o "palco", mas a interação crítica (cartela, botão Bingo, menus) é DOM/HTML responsivo por cima do canvas. O jogo continua jogável em qualquer celular, com qualidade 3D adaptativa e um modo 2D de fallback.

### 1.3 Princípio de design central

> **O 3D é palco, a HUD é DOM.**
> O canvas 3D renderiza cenário, avatares, globo e telão. Tudo que o jogador **precisa tocar ou ler para jogar** (cartela, botão Bingo, código da sala, toasts, modais) é HTML acessível sobreposto ao canvas. Assim o layout não quebra no mobile, o jogo funciona sem WebGL e o 3D pode ser degradado sem afetar as regras.

### 1.4 Métricas de sucesso

| Métrica | Meta |
|---|---|
| Partidas concluídas / partidas iniciadas | ≥ 85% |
| Bingos inválidos aceitos pelo servidor | 0 |
| Pontuação concedida sem vitória validada | 0 |
| Jogadores que reconectam e continuam na mesma partida | ≥ 95% das quedas < 60 s |
| FPS na partida, celular intermediário (ex.: Moto G / Galaxy A série 5x) | ≥ 30 FPS sustentados (p50) |
| FPS na partida, desktop | ≥ 60 FPS (p50) |
| Latência sorteio → bola visível em todos os clientes | p95 < 300 ms |
| Lighthouse PWA "installable" | aprovado |
| Taxa de fallback para modo 2D por falta de WebGL | medida (sem meta; informa decisões) |

---

## 2. Contexto

### 2.1 Background — o que a v1 ensina

Herdado da v1 (manter):

- Bingo americano B-I-N-G-O, números 1–75, cartela 5×5 com casa livre central.
- Fluxo: criar sala → entrar por código ou lista pública → gerar cartela → dono inicia → sorteio automático → primeiro Bingo válido vence.
- Convidado sem cadastro pode jogar; só conta Google pontua no ranking (+20 por vitória). **Muda na v2:** convidado pode virar conta Google sem perder o perfil (ver E1).
- Sala pública (listada) ou privada (só código); limite de participantes 10/15/25.

Corrigir (dívidas da v1 que viram requisito na v2):

| Dívida v1 | Requisito v2 |
|---|---|
| Vitória e pontos decididos no cliente | Servidor valida Bingo e concede pontos (RF-GAME-08, RF-RANK-01) |
| API sem auth; `user_id` arbitrário no body | Identidade vem só do token; ownership checado no servidor (RNF-SEC) |
| Segredo JWT hardcoded | Segredos só em variáveis de ambiente; `.env.example` versionado |
| Estado de partida em memória | Partida persistida no banco a cada número; reconexão recupera estado |
| `broadcast.emit` vazando entre salas | Todo evento emitido para a room Socket.IO da sala |
| Código de sala com dígitos 0–5 e colisão | Código de 6 caracteres alfanuméricos sem ambíguos, índice único |
| Coluna visual da cartela não bate com a faixa B/I/N/G/O | Cartela gerada e exibida por coluna, cada coluna na sua faixa |
| Ver cartela de outro usuário pela URL | Cartela só visível ao dono (e ao servidor) |
| Cookie sem HttpOnly; username injetado em `<script>` | Sessão gerenciada pelo provedor de auth; nada de dado de usuário interpolado em script |
| Sem testes, lint, Docker | Testes unitários das regras, e2e dos fluxos críticos, CI |

### 2.2 Público

- Grupos de amigos/colegas jogando remotamente (chamada de vídeo + bingo no celular).
- Jogadores casuais que entram por link compartilhado como convidado (só apelido) ou com Google em um toque.
- Jogadores registrados que competem no ranking.

Uso esperado majoritário: **celular em retrato**, aberto via link compartilhado no WhatsApp. Desktop é secundário, mas é onde o 3D brilha mais.

### 2.3 Referências

Bingos online (Pogo, Bingo Blitz) são 2D e focados em monetização. O diferencial do Go Bingo é a **presença social em 3D** (ver os amigos como bonecos na sala) com sessões curtas e sem fricção de cadastro.

---

## 3. Requisitos

### 3.1 Perfis

| Perfil | Como entra | Pode |
|---|---|---|
| Convidado | "Jogar como convidado" (Supabase `signInAnonymously`) + apelido | Criar/entrar em salas, jogar. Não pontua, não aparece no ranking. Pode virar conta Google mantendo o mesmo id. |
| Usuário | Login com Google (Supabase Auth) + escolha de apelido no primeiro acesso | Tudo do convidado + pontuar, aparecer no ranking, personalizar avatar persistente. |
| Dono da sala (host) | Quem criou a sala | Configura, inicia, pausa/retoma, cancela a sala, remove jogador. Se sair, o host passa para outro jogador. |

### 3.2 Épicos e histórias de usuário

Prioridade: **P0** = MVP v2.0 · **P1** = v2.1 · **P2** = futuro.

#### E1 — Identidade e sessão (P0)

**US-1.1** Como jogador, quero entrar com minha conta Google, para jogar sem criar senha.
- Login com Google via Supabase Auth (`signInWithOAuth({ provider: 'google' })`, fluxo PKCE). Não há cadastro por e-mail/senha no v2.0.
- Dado que abro um link de sala (`/{code}`) sem sessão, quando concluo o login com Google, então volto para essa mesma sala (destino preservado no `redirectTo`).
- Dado que cancelo ou o Google retorna erro, então volto à tela de login com a mensagem "Não foi possível entrar com Google. Tente novamente."
- Sessão renovada automaticamente pelo Supabase (refresh token); logout disponível no menu.

**US-1.2** Como jogador no primeiro acesso, quero escolher meu apelido, para não expor meu nome completo do Google.
- O campo vem pré-preenchido com o primeiro nome do Google, editável; 3–16 caracteres de `[A-Za-z0-9_À-ú ]`, sem palavrão da lista de bloqueio.
- O perfil (`Profile`) é criado no primeiro login; foto e nome completo do Google **não** são exibidos a outros jogadores.
- Apelido pode ser alterado depois no perfil.

**US-1.3** Como jogador que abriu o link dentro do Instagram/Facebook/outro navegador embutido, quero ser orientado a abrir no navegador, porque o Google bloqueia login em webviews (`disallowed_useragent`).
- Dado um user-agent de navegador embutido conhecido, então a tela de login mostra "Abra no navegador" com botão de copiar link (e intent para o Chrome no Android) no lugar do botão do Google, e mantém "Jogar como convidado" disponível.

**US-1.4** Como convidado, quero jogar só informando um apelido, para entrar rápido pelo link.
- Dado que abro um link de sala sem sessão, quando escolho "Jogar como convidado", resolvo o CAPTCHA (Turnstile, invisível quando possível) e informo um apelido válido (mesma regra da US-1.2), então entro na sala.
- O token do convidado tem `is_anonymous: true`; o servidor usa essa claim para negar pontos e ranking.
- Se eu limpar os dados do navegador ou trocar de aparelho, perco o perfil de convidado (aviso exibido uma vez).

**US-1.5** Como convidado, quero transformar meu perfil em conta Google, para salvar pontos futuros.
- CTA "Entrar com Google para salvar seus pontos" no menu e no modal de resultado.
- Ao confirmar, `linkIdentity({ provider: 'google' })` vincula o Google ao mesmo user id: apelido, avatar e histórico continuam.
- Dado que esse Google já tem conta no jogo, então o vínculo falha; o app explica "Essa conta Google já existe" e oferece entrar nela (o perfil de convidado é descartado — não há pontos a perder).

#### E2 — Avatar (P0 básico, P1 customização)

**US-2.1** Como jogador, quero ter um boneco que me represente na sala.
- P0: avatar gerado a partir do id (cor do corpo, cor do acessório, um de N chapéus) — determinístico, sem upload.
- P1: tela de customização (cor, chapéu, expressão) com preview 3D girável, salva no perfil.
- O avatar sempre exibe o apelido em um rótulo legível (billboard) acima da cabeça.

#### E3 — Salas e lobby 3D (P0)

**US-3.1** Como jogador, quero criar uma sala definindo nome, limite e visibilidade.
- Nome 3–24 caracteres; limite 10, 15 ou 25; pública ou privada.
- Código de 6 caracteres do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem 0/O/1/I), único no banco; em colisão o servidor gera outro (sem erro ao usuário).
- Após criar, recebo link compartilhável `/{code}` e botão "Compartilhar" (Web Share API no mobile, copiar no desktop).

**US-3.2** Como jogador, quero entrar numa sala por código, link ou lista pública.
- Lista pública mostra nome, ocupação x/máx e status (aguardando/em jogo); atualiza em tempo real.
- Código inválido → "Sala não encontrada". Sala cheia → "Sala cheia" (o servidor recusa antes de entrar; ninguém é "expulso" depois).
- Sala em andamento → pode entrar como **espectador** (vê o jogo, sem cartela). (P1; no P0 recusa com "Partida em andamento")

**US-3.3** Como jogador na sala de espera, quero ver os outros como bonecos na fila/plateia.
- Ao entrar, meu avatar caminha da porta até a próxima posição livre (animação ≤ 2 s).
- Ao sair/cair, o avatar acena e sai (ou fica "fantasma" translúcido durante a janela de reconexão de 60 s).
- Posições pré-definidas por slot (até 25); câmera enquadra todos os presentes.
- Lista textual de jogadores disponível na HUD (acessibilidade e telas pequenas).

**US-3.4** Como jogador, quero gerar e trocar minha cartela antes de começar.
- O servidor gera a cartela; posso pedir uma nova até o início (máx. 5 trocas).
- Indicador "pronto" quando tenho cartela; host vê quantos estão prontos.

**US-3.5** Como host, quero iniciar a partida quando houver jogadores suficientes.
- Botão Iniciar habilitado com ≥ 2 jogadores com cartela.
- Jogadores sem cartela recebem uma gerada automaticamente no início (corrige o "sem cartela → Home" da v1).
- Ao iniciar, a sala sai da lista pública e todos transitam juntos para a cena da partida.

**US-3.6** Como host, quero configurar a partida. (P1, exceto o padrão)
- Velocidade do sorteio: 3, 5 (padrão) ou 8 segundos.
- Padrão de vitória: cartela cheia (padrão P0), linha/coluna/diagonal (P1).
- Marcação: manual (padrão) ou automática (P1).

**US-3.7** Como host, quero cancelar a sala ou remover um jogador.
- Cancelar → todos voltam à Home com aviso "A sala foi encerrada pelo host".
- Se o host cair e não voltar em 60 s, o host passa ao jogador mais antigo da sala.

#### E4 — Partida 3D (P0)

**US-4.1** Como jogador, quero ver o sorteio acontecendo num globo/telão 3D.
- A cada intervalo, o servidor sorteia, persiste e emite o número; o globo gira e "solta" a bola com a letra e o número; o telão exibe a bola atual em destaque, as 4 anteriores e o painel 1–75 com os sorteados acesos.
- A animação é **cosmética**: começa ao receber o evento e nunca atrasa o número aparecer na HUD (a HUD mostra o número imediatamente; a animação dura ≤ intervalo − 1 s).
- Som de bola + narração sintetizada opcional ("B 7") com botão de mudo persistente. (narração P1)

**US-4.2** Como jogador, quero marcar minha cartela.
- A cartela fica na HUD (DOM) — sempre legível, alvo de toque ≥ 44×44 px.
- Só números já sorteados podem ser marcados; tocar num não sorteado dá feedback "ainda não saiu".
- Marcação é enviada ao servidor e persistida (sobrevive a reload e reconexão).
- Desktop (P1): cartela também representada em 3D sobre a mesa à frente do avatar; a HUD continua sendo a fonte de interação.

**US-4.3** Como jogador, quero sentir a presença dos outros durante a partida.
- Avatares dos outros jogadores ficam na plateia; quando alguém está a 1 pedra do padrão de vitória, o avatar dele ganha destaque (ex.: brilho/pulo) e a HUD mostra "Fulano está por 1!".
- Painel "Pedras que faltam" (da v1) mantido na HUD: jogador → quantidade restante, ordenado.
- Reações rápidas (emotes 👏😱😂) que aparecem sobre o avatar. (P1)

**US-4.4** Como jogador, quero pedir Bingo e ter a vitória validada.
- Botão **BINGO!** aparece habilitado quando, pelo meu estado local, completei o padrão; o servidor é quem decide.
- O servidor valida: a cartela pertence ao jogador, todos os números do padrão estão sorteados, a partida está em andamento e ninguém venceu antes. Marcação manual não é exigida para validar (o jogador não perde por não ter tocado num número que já saiu, mas precisa pedir o Bingo).
- Primeiro pedido válido (ordem de chegada no servidor) vence; o sorteio para imediatamente.
- Pedido inválido → "Bingo inválido" só para quem pediu; P1: penalidade configurável (bloqueio de 10 s).
- Todos veem a cena de vitória: câmera foca o avatar vencedor, confete, telão "BINGO! — Fulano". Vencedor vê "Você venceu! +20 pontos" (conta Google) ou "Você venceu!" + CTA "Entre com Google para salvar seus pontos" (convidado).

**US-4.5** Como jogador, quero voltar para a partida se minha conexão cair ou eu recarregar.
- Reconectando em até 60 s, recebo snapshot completo (números sorteados, minha cartela e marcações, jogadores, host) e continuo.
- Durante a queda, a HUD mostra "Reconectando…"; o sorteio continua para os outros.
- Se todos os 75 números saírem sem vencedor (só possível com padrões especiais/bugs), a partida termina "sem vencedor".

**US-4.6** Como jogador, quero jogar outra rodada com a mesma sala.
- Após o fim, host pode "Jogar de novo": mesmos jogadores voltam ao lobby, cartelas novas.

#### E5 — Ranking e perfil (P0 ranking, P1 perfil)

**US-5.1** Como usuário, quero ver o ranking.
- Top 50 por pontos; minha posição destacada mesmo se fora do top 50.
- Pódio 1º/2º/3º em 3D (avatares em pedestais) com fallback de lista. (pódio 3D P1)

**US-5.2** Como usuário, quero ver meu histórico: partidas jogadas, vitórias, pontos. (P1)

#### E6 — PWA e mobile (P0)

**US-6.1** Como jogador mobile, quero instalar o jogo na tela inicial.
- Manifest com nome, ícones (192/512 + maskable), `display: standalone`, cores do tema, orientação `any`.
- Prompt de instalação próprio no Android (`beforeinstallprompt`) e instrução "Compartilhar → Adicionar à Tela de Início" no iOS.

**US-6.2** Como jogador, quero que o app abra rápido mesmo com rede ruim.
- Service worker faz precache do app shell e cache-first dos assets 3D versionados (modelos, texturas, sons).
- Sem rede, a Home mostra "Você está offline" (o jogo exige conexão; não há modo offline de partida).

**US-6.3** Como jogador mobile, quero que a tela não quebre em nenhuma orientação.
- Ver seção 4.3 (layouts). Respeitar `safe-area-inset-*`, usar `100dvh`, sem zoom acidental em double-tap na cartela.
- Wake Lock durante a partida para a tela não apagar (quando suportado).

### 3.3 Requisitos funcionais

#### Cartela (RF-CARD)

| ID | Requisito |
|---|---|
| RF-CARD-01 | O servidor deve gerar a cartela; o cliente nunca gera nem envia números de cartela. |
| RF-CARD-02 | Coluna B contém 5 números distintos de 1–15; I de 16–30; N 4 números de 31–45 + casa livre na posição central; G de 46–60; O de 61–75. |
| RF-CARD-03 | A cartela deve ser armazenada como matriz 5×5 por coluna (posição preservada), e exibida exatamente nessa disposição. |
| RF-CARD-04 | A casa livre conta como marcada para qualquer padrão. |
| RF-CARD-05 | Um jogador deve ter no máximo 1 cartela por partida (P0). |

#### Sorteio e partida (RF-GAME)

| ID | Requisito |
|---|---|
| RF-GAME-01 | O servidor deve sortear números de 1–75 sem repetição escolhendo com `crypto.randomInt` entre os números restantes — sem recursão. |
| RF-GAME-02 | Cada número sorteado deve ser persistido (com ordem e timestamp) antes de ser emitido aos clientes. |
| RF-GAME-03 | O servidor deve emitir o número apenas para a room Socket.IO da sala. |
| RF-GAME-04 | O intervalo entre números deve ser o configurado na sala (padrão 5 s). |
| RF-GAME-05 | O sorteio deve ser conduzido pelo servidor, independente da conexão do host. |
| RF-GAME-06 | Após reinício do servidor, partidas `IN_PROGRESS` devem ser retomadas a partir do último número persistido. |
| RF-GAME-07 | Marcações devem ser aceitas só para números da cartela do jogador já sorteados; demais são rejeitadas. |
| RF-GAME-08 | O servidor deve validar pedidos de Bingo conforme US-4.4 e registrar o vencedor numa transação que garante um único vencedor por partida (ex.: `UPDATE ... WHERE winner_id IS NULL`). |
| RF-GAME-09 | Ao validar uma vitória, o servidor deve parar o sorteio e emitir `game:won` a toda a sala em ≤ 300 ms (p95). |
| RF-GAME-10 | O servidor deve manter e emitir, por jogador, a contagem de pedras restantes (derivada no servidor das cartelas + sorteados, não do clique do cliente). |

#### Ranking (RF-RANK)

| ID | Requisito |
|---|---|
| RF-RANK-01 | Pontos (+20 por vitória) devem ser concedidos pelo servidor na mesma transação que registra o vencedor; não existe endpoint de "adicionar pontos". |
| RF-RANK-02 | Convidados (`is_anonymous`) nunca pontuam nem aparecem no ranking; contas Google aparecem a partir da primeira partida jogada. |
| RF-RANK-03 | Ranking deve ser servido paginado e cacheado por até 60 s. |

### 3.4 Requisitos não funcionais

#### Performance 3D (RNF-3D)

| ID | Requisito |
|---|---|
| RNF-3D-01 | O bundle 3D (three, R3F, drei, cenas) deve ser carregado sob demanda (`next/dynamic`, `ssr: false`) — Home, login e ranking em lista não baixam three.js. |
| RNF-3D-02 | Peso total de assets 3D por cena ≤ 3 MB (gzip/brotli), modelos glTF com Draco/Meshopt e texturas KTX2. |
| RNF-3D-03 | ≤ 100 draw calls na cena da partida com 25 jogadores (avatares via instancing ou geometria compartilhada; bolas do painel via `InstancedMesh`). |
| RNF-3D-04 | DPR adaptativo: iniciar em `min(devicePixelRatio, 1.5)`, reduzir até 1 (ou `performance.min` 0.5) quando o `PerformanceMonitor` detectar queda; aumentar até 2 em desktop com folga. |
| RNF-3D-05 | Três níveis de qualidade (Alto/Médio/Baixo) selecionados automaticamente por GPU tier + `PerformanceMonitor`, com override manual nas configurações. Baixo: sem sombras dinâmicas, sem pós-processamento, iluminação baked, avatares simplificados. |
| RNF-3D-06 | **Modo 2D**: ativado automaticamente sem WebGL2, com `prefers-reduced-motion`, ou manualmente. Toda funcionalidade de jogo deve funcionar no modo 2D. |
| RNF-3D-07 | Render em pausa quando a aba/app está em segundo plano; no lobby ocioso usar `frameloop="demand"` quando nada anima. |
| RNF-3D-08 | Perda de contexto WebGL (comum no iOS) deve ser tratada: recriar a cena ou cair para o modo 2D, sem perder o estado de jogo. |

#### Realtime (RNF-RT)

| ID | Requisito |
|---|---|
| RNF-RT-01 | Socket.IO com autenticação no handshake (token validado no `connection`); conexão sem token válido é recusada. |
| RNF-RT-02 | Payloads de todos os eventos validados com Zod no servidor (contrato compartilhado front/back). |
| RNF-RT-03 | Rate limit por socket: no máximo 10 eventos/s; `bingo:claim` no máximo 1 por 2 s. |
| RNF-RT-04 | Suportar 200 salas simultâneas × 25 jogadores numa única instância (meta v2.0). Escala horizontal (adapter Redis) só quando a métrica pedir — registrar como decisão futura. |

#### Segurança (RNF-SEC)

- Identidade do jogador vem **exclusivamente** do token verificado; nenhum endpoint/evento aceita `userId` no body para identificar quem age.
- Toda ação de host (iniciar, cancelar, remover, configurar) checa `room.hostId === user.id` no servidor.
- Segredos só em env; `.env.example` sem valores reais. CORS restrito à origem do front. Helmet no Nest. Rate limit nas rotas de auth.
- Apelidos/nome de sala renderizados apenas como texto (React escapa; no 3D via `Text` do drei, nunca HTML cru).
- Se alguma tabela for acessada via `supabase-js`/PostgREST: RLS obrigatória (constituição, princípio IV). No desenho deste PRD, o front **não** acessa tabelas diretamente — só auth do Supabase e a API Nest.

#### Mobile, acessibilidade, compatibilidade

- Navegadores alvo: Chrome Android ≥ últimas 2 versões, Safari iOS ≥ 17, Chrome/Edge/Firefox/Safari desktop atuais.
- Layout funcional de 320 px de largura até 4K, retrato e paisagem.
- WCAG 2.1 AA na HUD: contraste, foco visível, leitores de tela anunciam número sorteado (`aria-live="polite"`) e vitória.
- Canvas 3D é decorativo para leitores de tela (`aria-hidden`), pois toda informação essencial está na HUD.
- i18n: textos em pt-BR centralizados para permitir inglês depois (P2).

#### Disponibilidade e observabilidade

- Healthcheck `/health` no Nest. Logs estruturados com `roomId`/`gameId`. Captura de erros do front (ex.: Sentry) incluindo perda de contexto WebGL e FPS médio por sessão (amostrado).

---

## 4. Design

### 4.1 Fluxo do usuário

```
Link/Home ──► [sem sessão] Login Google ou Convidado ──► [1º acesso] Apelido
     │
     ├─► Criar sala ──► Lobby 3D (host) ──┐
     └─► Código / lista ──► Lobby 3D ─────┤
                                          ▼
                              Host inicia (≥2 com cartela)
                                          ▼
                              Partida 3D (globo + telão + plateia)
                                          ▼
                       Bingo válido ──► Cena de vitória ──► Jogar de novo │ Sair
```

### 4.2 Cenas 3D

| Cena | Conteúdo 3D | HUD (DOM) |
|---|---|---|
| **Home** | Nenhum (ou fundo leve estático) — prioridade é carregar rápido | Entrar por código, criar sala, lista pública, ranking |
| **Lobby** | Salão/auditório, porta de entrada, avatares em fila/plateia por slot, palco com globo parado e telão exibindo o código da sala | Código + compartilhar, lista de jogadores, minha cartela (preview), gerar/trocar, Iniciar (host) |
| **Partida** | Palco: globo girando, bola saindo, telão com bola atual + 4 anteriores + painel 1–75; plateia com avatares; destaque de quem está "por 1" | Cartela, último número, botão BINGO!, pedras que faltam, mudo, sair |
| **Vitória** | Câmera vai ao vencedor, confete (partículas instanciadas), telão "BINGO!" | Modal de resultado, pontos, Jogar de novo / Sair |
| **Pódio** (P1) | Top 3 em pedestais | Lista completa |

Direção visual: low-poly estilizado, cores saturadas, iluminação quente de "salão de bingo/game show". Estilo low-poly mantém o peso baixo e fica bem em telas pequenas.

### 4.3 Layouts responsivos

```
CELULAR RETRATO                    CELULAR PAISAGEM / TABLET          DESKTOP
┌──────────────────┐               ┌──────────────┬─────────┐         ┌──────────────────────┬──────────┐
│  canvas 3D       │ ~40% dvh      │              │ cartela │         │                      │ jogadores│
│  (telão+globo)   │               │  canvas 3D   │  5×5    │         │     canvas 3D        │ pedras   │
│  [último: B 7]   │               │              │         │         │  (palco + plateia)   │          │
├──────────────────┤               │              │ BINGO!  │         │                      ├──────────┤
│  cartela 5×5     │ ~50% dvh      └──────────────┴─────────┘         │                      │ cartela  │
│  (DOM, ≥44px)    │                                                   │                      │ BINGO!   │
├──────────────────┤                                                   └──────────────────────┴──────────┘
│ [pedras] [BINGO!]│ barra fixa + safe-area
└──────────────────┘
```

Regras:
- O canvas ocupa uma **região do layout** (não a tela inteira atrás de tudo) no mobile retrato, para a cartela nunca ser coberta.
- A câmera da cena ajusta FOV/enquadramento ao aspect ratio (retrato: foco no telão; paisagem/desktop: palco + plateia).
- Em telas < 360 px de largura, o painel 1–75 do telão some do 3D e vira grid compacto na HUD sob demanda.
- Gestos: sem orbit controls livres na partida (evita conflito com scroll/toques); no máximo arrastar para girar levemente no lobby.

### 4.4 Arquitetura técnica

```
┌──────────────── go-bingo-front (Vercel) ────────────────┐
│ Next.js App Router · TS · Tailwind · shadcn/ui · Zustand │
│  ├─ app/ (rotas, manifest.ts, SW via Serwist)            │
│  ├─ game/hud/      componentes DOM                       │
│  ├─ game/scene/    R3F + drei (lazy, ssr:false)          │
│  ├─ game/store     Zustand: estado do jogo (do servidor) │
│  └─ socket client  socket.io-client + contrato Zod       │
└──────────────┬───────────────────────┬───────────────────┘
               │ HTTPS (REST)          │ WSS (Socket.IO)
┌──────────────▼───────────────────────▼───────────────────┐
│ go-bingo-back (container: Railway/Fly/Render/VPS)         │
│ NestJS · REST controllers · Socket.IO Gateway             │
│  ├─ AuthGuard (valida JWT do Supabase via JWKS)           │
│  ├─ RoomsModule · GamesModule (scheduler de sorteio)      │
│  ├─ CardsModule (geração/validação) · RankingModule       │
│  └─ Prisma Client                                         │
└──────────────┬────────────────────────────────────────────┘
               │ Postgres (pooler)
┌──────────────▼────────────────┐
│ Supabase: Postgres + Auth     │
│ (Google + anonymous sign-in)  │
└───────────────────────────────┘
```

Decisões (registrar em `plan.md` de cada repo):

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Prisma ORM sobre Postgres do Supabase**; schema e migrations só pelo Prisma. | Pedido do autor (Nest + Prisma + Supabase). Uma fonte de verdade para o schema. |
| D2 | **Auth pelo Supabase Auth: Google + anonymous sign-in (convidado)**; upgrade via `linkIdentity`. Front usa `@supabase/ssr`; Nest só verifica o JWT do Supabase (JWKS) no REST e no handshake do Socket.IO e lê a claim `is_anonymous`. | Decisão do autor. Sem senha para guardar; convidado mantém a entrada por link sem atrito e contorna o bloqueio do Google em webviews; mesmo `auth.users.id` antes e depois do upgrade. |
| D3 | **Realtime pelo Socket.IO no NestJS**, não Supabase Realtime. | Lógica de jogo (sorteio, validação) precisa ser autoritativa no servidor; um único canal para estado e eventos. |
| D4 | Backend em **container de processo longo**, não serverless. | WebSocket persistente + timers de sorteio. Vercel Functions não serve para isso. |
| D5 | **Contrato compartilhado**: pasta `contracts/` no back (fonte da verdade) + script que copia para o front. | Front e back validam o mesmo formato, sem infra de pacote. Ver Q4. |
| D6 | Estado efêmero (quem está conectado, timers) em memória da instância; estado de jogo (sorteados, cartelas, marcações, vencedor) no Postgres. | Sobrevive a reinício sem precisar de Redis no v2.0 (YAGNI). |
| D7 | `project.config.json`: `preset: "prisma-postgres"`, `auth: "supabase-auth"`, `database: "prisma-postgres"` (host Supabase). | A combinação foge dos presets prontos — registrar como exceção no Complexity Tracking. |

### 4.5 Modelo de dados (Prisma, rascunho)

```prisma
model Profile {
  id         String   @id @db.Uuid          // = auth.users.id do Supabase
  nickname   String   @db.VarChar(16)
  isGuest    Boolean  @default(true)        // espelho de is_anonymous, atualizado no upgrade
  points     Int      @default(0)
  avatar     Json                          // { body, accent, hat, face }
  createdAt  DateTime @default(now())
  @@index([points(sort: Desc)])
}

model Room {
  id          String     @id @default(uuid()) @db.Uuid
  code        String     @unique @db.Char(6)
  name        String     @db.VarChar(24)
  hostId      String     @db.Uuid
  maxPlayers  Int                            // 10 | 15 | 25
  isPublic    Boolean
  status      RoomStatus @default(WAITING)   // WAITING | IN_GAME | CLOSED
  drawIntervalMs Int     @default(5000)
  winPattern  WinPattern @default(FULL_CARD)
  createdAt   DateTime   @default(now())
  members     RoomMember[]
  games       Game[]
  @@index([isPublic, status])
}

model RoomMember {
  roomId   String  @db.Uuid
  userId   String  @db.Uuid
  slot     Int                               // posição na plateia 3D
  joinedAt DateTime @default(now())
  leftAt   DateTime?
  @@id([roomId, userId])
  @@unique([roomId, slot])
}

model Game {
  id         String     @id @default(uuid()) @db.Uuid
  roomId     String     @db.Uuid
  status     GameStatus @default(IN_PROGRESS) // IN_PROGRESS | FINISHED | CANCELLED
  drawnCount Int        @default(0)
  winnerId   String?    @db.Uuid
  startedAt  DateTime   @default(now())
  finishedAt DateTime?
  cards      Card[]
  draws      Draw[]
}

model Draw {
  gameId   String   @db.Uuid
  seq      Int
  number   Int
  drawnAt  DateTime @default(now())
  @@id([gameId, seq])
  @@unique([gameId, number])
}

model Card {
  id      String @id @default(uuid()) @db.Uuid
  gameId  String? @db.Uuid                    // null enquanto no lobby
  roomId  String @db.Uuid
  userId  String @db.Uuid
  grid    Int[]                              // 25 posições, coluna-major, 0 = casa livre
  marked  Int[]                              // índices marcados
  @@unique([roomId, userId, gameId])
}
```

Observações: o próximo número é sorteado na hora entre os que faltam (Q6), então nada no banco revela números futuros. Mesmo assim o front não acessa tabelas diretamente. Atenção: `@@unique` com `gameId` nulo não impede duplicatas no Postgres — a regra de uma cartela por jogador no lobby precisa de índice parcial (migration SQL) ou checagem no service.

### 4.6 Contrato de eventos Socket.IO (rascunho)

Namespace `/game`; toda emissão do servidor é para `room:{code}` ou para o socket individual.

| Direção | Evento | Payload | Regra |
|---|---|---|---|
| C→S | `room:join` | `{ code }` | Valida existência, capacidade, status. Responde por ack com `RoomSnapshot`. |
| C→S | `room:leave` | `{}` | |
| C→S | `card:generate` | `{}` | Só no lobby; máx. 5 por jogador. Ack com `Card`. |
| C→S | `game:start` | `{}` | Só host; ≥ 2 jogadores. |
| C→S | `room:configure` | `{ drawIntervalMs?, winPattern? }` | Só host, só no lobby. |
| C→S | `room:kick` | `{ userId }` | Só host. |
| C→S | `card:mark` | `{ index }` | Número precisa estar sorteado. |
| C→S | `bingo:claim` | `{}` | Validação completa no servidor. |
| C→S | `reaction:send` (P1) | `{ emote }` | Rate limited. |
| S→C | `room:state` | `RoomSnapshot` | Enviado ao (re)conectar. |
| S→C | `room:member_joined` / `room:member_left` | `{ member }` / `{ userId, reason }` | Dispara animação de entrada/saída do avatar. |
| S→C | `room:host_changed` | `{ hostId }` | |
| S→C | `game:started` | `{ gameId, drawIntervalMs }` | Transição de cena. |
| S→C | `game:number_drawn` | `{ seq, number, letter, drawnAt }` | |
| S→C | `game:progress` | `{ remaining: Record<userId, number> }` | Pedras que faltam. |
| S→C | `bingo:rejected` | `{ reason }` | Só para quem pediu. |
| S→C | `game:won` | `{ winnerId, nickname, pointsAwarded, card }` | Inclui a cartela vencedora para exibição. |
| S→C | `room:closed` | `{ reason }` | |

### 4.7 API REST (rascunho)

| Método | Rota | Auth | Função |
|---|---|---|---|
| GET | `/rooms?public=true` | sim | Lista salas públicas aguardando |
| POST | `/rooms` | sim | Cria sala (host = usuário do token) |
| GET | `/rooms/:code` | sim | Metadados públicos da sala |
| GET | `/ranking?cursor=` | sim | Ranking paginado |
| GET/PATCH | `/me` | sim | Perfil (apelido, avatar) |
| GET | `/me/games` (P1) | sim | Histórico |
| GET | `/health` | não | Healthcheck |

---

## 5. Escopo

### 5.1 Dentro do escopo (v2.0 — P0)

E1 completo (Google + convidado), E2 avatar determinístico, E3 completo exceto configuração avançada e espectador, E4 completo exceto cartela 3D na mesa/emotes/narração, E5 ranking em lista, E6 completo, modo 2D, níveis de qualidade 3D.

### 5.2 Fora do escopo (v2.0)

- Dinheiro real, apostas, compras, anúncios.
- Chat de texto/voz (o público já usa chamada de vídeo).
- Múltiplas cartelas por jogador.
- Notificações push.
- Modo offline de partida.
- App nativo (lojas). PWA cobre o caso.
- Escala horizontal multi-instância (Redis adapter) — só quando a métrica RNF-RT-04 for atingida.

### 5.3 Futuro (P1/P2)

P1: customização de avatar, padrões de vitória extras, velocidade configurável, marcação automática, espectador, emotes, narração, pódio 3D, histórico, cartela 3D no desktop.
P2: temas de salão (praia, espaço), i18n inglês, torneios/temporadas de ranking, outros providers de login (Apple, Discord, e-mail).

---

## 6. Cronograma

### 6.1 Marcos

A ordem é proposital: **o jogo 2D autoritativo vem antes do 3D**. O 3D é uma camada sobre um jogo que já funciona — isso também entrega o modo 2D de graça.

| Marco | Entrega | Repos | Critério de saída |
|---|---|---|---|
| M0 — Fundação | `project.config.json`, constituição do projeto, Nest + Prisma + Supabase conectados, Next com Tailwind/shadcn, CI (lint, typecheck, testes), `.env.example`, contrato Zod compartilhado | ambos | Deploy de "hello" nos dois ambientes |
| M1 — Núcleo do jogo (2D) | Login Google + convidado + apelido, salas, cartela no servidor, sorteio persistido, marcação, validação de Bingo, pontos, reconexão, ranking em lista — tudo com HUD 2D | ambos | Partida completa entre 3 celulares; testes de regra cobrindo RF-CARD/RF-GAME; reinício do servidor no meio da partida não perde o jogo |
| M2 — PWA e mobile | Manifest, SW (Serwist), layouts retrato/paisagem, safe-area, wake lock, instalação | front | Lighthouse installable; jogo testado em Android e iPhone reais |
| M3 — Lobby 3D | Cena do salão, avatares determinísticos, animações entrar/sair, sistema de qualidade + `PerformanceMonitor`, fallback 2D, lazy load | front | ≥ 30 FPS no celular de referência com 25 avatares |
| M4 — Partida 3D | Globo, telão, painel 1–75 instanciado, destaque "por 1", cena de vitória, sons | front (+ eventos no back) | Metas de FPS e de 300 ms p95; zero regressão no modo 2D |
| M5 — Polimento e lançamento | Observabilidade, testes e2e (Playwright) dos fluxos críticos, `/security` + `/review`, beta fechado com amigos | ambos | Gate de segurança PASS; métricas da seção 1.4 coletadas |

### 6.2 Dependências

- Supabase: projeto criado, provider Google, **Anonymous sign-ins**, **Manual linking** e CAPTCHA (Turnstile) habilitados (OAuth client no Google Cloud Console com redirect URI do Supabase; URLs do front — local, preview e produção — na allow list de redirect do Supabase), connection pooler configurado para o Prisma (`DATABASE_URL` pooled + `DIRECT_URL` para migrations).
- Hospedagem do backend com suporte a WebSocket (Q2).
- Assets 3D: modelos low-poly (globo, palco, avatar base com animações idle/walk/wave/jump). Comprar/licenciar (CC0, ex.: Kenney/Quaternius) ou modelar (Q3).
- Contrato de eventos (4.6) congelado antes de M1 no front.

### 6.3 Riscos

| Risco | Impacto | Probabilidade | Mitigação |
|---|---|---|---|
| Desempenho 3D ruim em celulares de entrada / aquecimento | Alto | Alta | HUD em DOM, qualidade adaptativa, orçamento de draw calls e assets, modo 2D, testes em aparelho real desde M3 |
| Safari iOS: perda de contexto WebGL, limite de memória, PWA sem alguns recursos (prompt de instalação) | Médio | Alta | RNF-3D-08, texturas KTX2 pequenas, instrução manual de instalação |
| Socket cai quando o app vai para segundo plano no mobile | Médio | Alta | Reconexão com snapshot (US-4.5), janela de 60 s, sorteio independe do cliente |
| Escopo 3D crescer e atrasar o jogo | Alto | Média | M1 entrega jogo completo em 2D; 3D com orçamento por marco |
| Corrida em pedidos de Bingo simultâneos | Alto | Média | Update condicional atômico (RF-GAME-08) + teste de concorrência |
| Mistura Prisma + Supabase Auth gerar confusão de presets/skills | Baixo | Média | D7 registrado; Prisma é dono do schema, Supabase só Auth |
| Login Google bloqueado em navegadores embutidos (Instagram, Facebook) | Médio | Média | US-1.3: detectar webview e orientar a abrir no navegador |
| OAuth em PWA instalado no iOS abre o Safari e a sessão não volta ao app standalone | Médio | Média | Fluxo PKCE com callback em rota do próprio app; testar em iPhone real no M2; se falhar, login antes de instalar |
| Abuso de criação de usuários anônimos | Médio | Média | CAPTCHA no `signInAnonymously`, rate limit do Supabase, job diário que apaga convidados sem atividade há 30 dias |
| Bundle 3D pesado prejudicar o primeiro acesso via link | Médio | Média | RNF-3D-01/02, precache após primeiro load, tela de carregamento com progresso |

### 6.4 Alinhamento

| Papel | Interesse | Aprovação |
|---|---|---|
| Autor (produto + engenharia) | Escopo, viabilidade | Sim |
| Design 3D/UX (mesma pessoa ou colaborador) | Direção visual, layouts mobile | Sim |
| QA (testes manuais em aparelhos) | Cobertura de dispositivos | Sim |
| Segurança | `/security` antes do lançamento (auth, dados de usuário) | Sim |

---

## 7. Apêndice

### 7.1 Perguntas em aberto

| # | Pergunta | Recomendação |
|---|---|---|
| Q1 | ~~Auth~~ — **decidido:** Google + convidado no P0 (D2). | — |
| Q2 | Onde hospedar o NestJS (Railway, Fly.io, Render, VPS Hostinger)? | **Adiado:** M0/M1 rodam local com Docker; decidir antes do primeiro deploy. Front na Vercel. |
| Q3 | Assets 3D: pacote CC0 pronto ou modelagem própria? | Começar com CC0 (Kenney/Quaternius) para M3/M4; arte própria depois. |
| Q4 | Contrato compartilhado: pacote npm privado, git submodule, ou monorepo? | **Decidido:** o back é dono de `contracts/` (schemas Zod de eventos e DTOs); um script copia para o front. Migrar para pacote se a cópia virar dor. |
| Q5 | Padrão de vitória P0: só cartela cheia (como v1)? | Sim no P0 — partidas de cartela cheia duram ~3–5 min com intervalo de 5 s, bom para mostrar o 3D. Linha/coluna no P1. |
| Q6 | Pré-embaralhar `drawOrder` ou sortear número a número? | Número a número com `crypto.randomInt` sobre os restantes: nada sensível fica guardado. Persistência de cada `Draw` já garante retomada. |
| Q7 | Nome do produto: "Go Bingo" substitui "Collab Bingo"? | Confirmar antes de gerar ícones e manifest. |
| Q8 | Pontuação: fixa +20 ou proporcional ao número de jogadores? | Fixa no P0 (compatível com v1). |

### 7.2 Glossário

- **Pedra:** casa da cartela / número sorteado.
- **Por 1:** jogador a uma pedra de completar o padrão.
- **HUD:** interface 2D (HTML) sobreposta ao canvas 3D.
- **Host:** dono da sala.
- **Modo 2D:** experiência completa sem renderização 3D.

### 7.3 Referências técnicas

- R3F — Scaling performance (`PerformanceMonitor`, DPR adaptativo, `frameloop="demand"`, instancing).
- Next.js — guia de Progressive Web Apps (`app/manifest.ts`, service worker).
- PRD v1 (engenharia reversa do `spaceowls/collab-bingo`) — seção 8 = lista de dívidas que viram requisitos na seção 2.1 deste documento.
