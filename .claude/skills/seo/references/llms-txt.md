# llms.txt

Arquivo `/llms.txt` (na raiz pública do site, servido em
`https://dominio.com/llms.txt`) — representação estruturada e objetiva do
projeto para agentes e sistemas de IA/LLMs consumirem.

Referência: [especificação llms.txt](https://llmstxt.org/).

## O que incluir (só quando existir de verdade)

- O que é o produto/empresa.
- Principal problema resolvido.
- Público-alvo.
- Principais funcionalidades.
- Diferenciais.
- Links para páginas públicas importantes (docs, FAQ, preços, contato).

## Regras

- [ ] Formato Markdown, seguindo a estrutura da especificação (H1 com o
      nome, um parágrafo de resumo, seções com listas de links).
- [ ] Nenhuma informação inventada — se um dado (preço, feature) não está
      confirmado ou público, omita a seção em vez de supor.
- [ ] Objetivo e enxuto — não é o lugar para copy de marketing extenso,
      é para uma IA entender rápido do que se trata e onde achar mais
      detalhe.
- [ ] Atualizado junto com mudanças relevantes de produto — se uma feature
      citada for descontinuada, o arquivo deve refletir isso (não é
      "escreve uma vez e esquece").
- [ ] Next.js: sirva como rota estática (`app/llms.txt/route.ts` retornando
      `text/plain`, ou arquivo em `public/llms.txt`) — mais simples é
      `public/llms.txt`, a menos que o conteúdo precise ser gerado
      dinamicamente a partir de dado real do projeto.

## Antes de criar

Verifique se já existe `public/llms.txt` ou rota equivalente — se existir,
revise e atualize em vez de recriar do zero.
