# AI Search / GEO (Generative Engine Optimization)

Otimização para que sistemas de busca generativa e agentes de IA
entendam e citem corretamente o projeto.

## O que priorizar

- [ ] Informação clara e factual sobre: o que é o produto, para quem é,
      qual problema resolve, como funciona, principais recursos,
      diferenciais, preço (quando público), segurança, como começar.
- [ ] Linguagem natural — frases completas que respondem uma pergunta
      real, não fragmentos otimizados só para palavra-chave.
- [ ] Estrutura semântica: heading hierárquico, listas, FAQ marcado com
      schema (`FAQPage` via JSON-LD, se aplicável) — facilita extração por
      sistemas que fazem parsing estruturado.
- [ ] Entidades bem definidas: nome do produto, categoria, público-alvo
      mencionados de forma consistente entre páginas (não varia o nome do
      produto entre "App", "Plataforma", "Sistema" sem motivo).
- [ ] `llms.txt` atualizado (ver `llms-txt.md`) — é o sinal mais direto
      para agentes de IA.
- [ ] FAQ e cases (ver `content-conversion.md`) são também conteúdo que
      sistemas de busca generativa costumam citar diretamente — vale
      investir na clareza desses blocos.

## O que evitar

- Não crie conteúdo artificial só para tentar manipular um mecanismo de
  IA (texto repetitivo, listas de palavra-chave sem frase real).
- Não prometa recurso, resultado ou dado que o produto não tem — um agente
  de IA que cita informação errada do seu próprio site gera desconfiança
  quando o usuário chega e não encontra o que foi descrito.

## Relação com SEO tradicional

A maior parte do trabalho de GEO é o mesmo do SEO on-page bem feito
(`on-page-seo.md`) mais estrutura semântica explícita — não é uma
disciplina totalmente separada, é uma camada adicional de clareza sobre a
mesma base.
