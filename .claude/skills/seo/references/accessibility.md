# Acessibilidade (WCAG 2.2)

Checklist de acessibilidade baseado no WCAG 2.2, organizado pelos 4
princípios (POUR). Meta: conformidade **AA** (padrão de mercado e
exigência legal em várias jurisdições) — AAA é bônus, não meta.

Componentes vindos de `components/ui/` (shadcn/Radix) já cobrem boa parte
disso por padrão (foco, ARIA, navegação por teclado) — o que precisa de
auditoria de verdade é **composição própria**: página, formulário
customizado, componente de domínio que não é só uma primitiva shadcn.

## Perceivable (Perceptível)

- [ ] Toda imagem de conteúdo tem `alt` descritivo; imagem decorativa usa
      `alt=""`. Botão só com ícone tem `aria-label` (ex.: `aria-label="Abrir
      menu"`), não fica mudo pra leitor de tela.
- [ ] Contraste de cor mínimo AA: texto normal `4.5:1`, texto grande
      (≥18px ou ≥14px bold) `3:1`, componente de UI/ícone `3:1`. Não
      confiar no olho — medir de verdade (DevTools, contrast checker).
- [ ] Erro/status nunca comunicado só por cor (ex.: borda vermelha sozinha)
      — sempre cor + ícone + texto.
- [ ] Vídeo com legenda (`<track kind="captions">`), áudio com transcript
      quando o conteúdo for relevante (ex.: vídeo de produto na landing).

## Operable (Operável)

- [ ] Elemento interativo usa elemento nativo (`<button>`, `<a href>`,
      input) sempre que possível — foco, ativação por teclado e semântica
      vêm de graça. `div` com `onClick` sem `role`/`tabIndex`/handler de
      teclado é bug, não estilo.
- [ ] `:focus-visible` nunca removido (`outline: none` sem substituto).
      Contraste do indicador de foco ≥3:1 contra o fundo.
- [ ] Sem armadilha de teclado — usuário sempre consegue Tab pra dentro e
      pra fora de modal/dropdown/menu. Modal usa `<dialog>` nativo ou
      padrão de focus trap equivalente.
- [ ] Alvo de toque/clique com no mínimo **24×24px** (WCAG 2.2, critério
      2.5.8) — exceção pra link inline em texto corrido.
- [ ] `prefers-reduced-motion: reduce` respeitado — anima menos ou nada
      quando o usuário pediu.
- [ ] Elemento em foco nunca fica totalmente escondido atrás de header/
      footer sticky (`scroll-margin-top` compensando altura do header
      fixo).

## Understandable (Compreensível)

- [ ] `<html lang="...">` definido corretamente.
- [ ] Todo campo de formulário tem `<label>` associado (`htmlFor`/`id`) —
      `placeholder` não é label.
- [ ] Erro de formulário: `aria-invalid="true"` no campo, mensagem
      associada via `aria-describedby`, anunciada a leitor de tela
      (`role="alert"` ou `aria-live`), foco vai pro primeiro campo com
      erro no submit.
- [ ] **Autenticação acessível** (WCAG 2.2, critério 3.3.8 — relevante pra
      login do Better Auth/Supabase Auth): fluxo de login não pode
      depender só de "lembrar senha de cor" sem alternativa — permitir
      colar senha (`autocomplete="current-password"`, nunca bloquear
      paste), e oferecer alternativa (magic link, passkey, SSO) quando
      fizer sentido pro produto.
- [ ] Não forçar o usuário a digitar de novo informação já dada na mesma
      sessão (ex.: endereço de cobrança igual ao de entrega — oferecer
      "usar o mesmo").
- [ ] Navegação e mecanismo de ajuda (chat, FAQ, contato) aparecem na
      mesma posição relativa em toda página onde existem.

## Robust (Robusto)

- [ ] ARIA só quando não dá pra usar elemento nativo equivalente —
      `role="button"` num `div` é fallback, não primeira escolha.
- [ ] Mudança de conteúdo dinâmico sem navegação (toast, contador,
      resultado de busca) usa `aria-live` pra ser anunciada sem roubar o
      foco do usuário.

## Testes

- [ ] Automatizado: `npx lighthouse <url> --only-categories=accessibility`
      ou `axe` (`@axe-core/cli` ou extensão de browser) — pega boa parte,
      mas **score 100 não é sinônimo de conformidade WCAG**, é só a fração
      que dá pra automatizar.
- [ ] Manual, no mínimo: navegar a página inteira só de teclado (Tab/
      Enter/Espaço/Esc); testar com leitor de tela (VoiceOver no Mac, NVDA
      no Windows) no fluxo crítico (signup/login/checkout); zoom 200%
      sem quebrar layout.

## Prioridade quando o tempo é curto

1. **Crítico**: label de formulário faltando, `alt` faltando, contraste
   insuficiente, armadilha de teclado, foco invisível.
2. **Sério**: `lang` faltando, hierarquia de heading quebrada, link "clique
   aqui" sem contexto, mídia autoplay, sem skip link.
3. **Moderado**: `aria-label` faltando em ícone, navegação inconsistente
   entre páginas, região de landmark ausente.

## Referências

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
