# Contribuindo com o ScreenShare

Obrigado por colaborar. Antes de começar, leia o `README.md` e procure uma issue no **ScreenShare Roadmap**. Mudanças devem preservar React/TypeScript no frontend e Tauri/Rust na camada desktop.

## Fluxo de trabalho

1. Escolha uma ou mais issues atribuídas à sua área: frontend para `@Ruthraas` e backend para `@ProgVictorPe`.
2. Crie uma branch curta **a partir de `main`** (não de outra branch de feature ainda não mergeada) — ex. `fix/oauth-tauri` ou `feat/screen-capture`. PRs empilhados uns nos outros (base numa branch que não é `main`) só avançam a branch intermediária quando mergeados, não o `main` — evite essa armadilha.
3. Agrupe num único pull request as issues que formam uma etapa completa e coerente (ex. "base executável do backend": serviço mínimo + config + auth + schema), em vez de abrir um PR por issue isolada. Sempre abra PR — nunca comite direto em `main` — mas prefira menos PRs maiores e completos a muitos PRs pequenos e fragmentados. Liste todas as issues fechadas com `Closes #N` (uma linha por issue).
4. Atualize testes e documentação quando o comportamento mudar.
5. Antes de abrir o PR, execute:

```powershell
npm ci
npm run build
```

Para alterações em Rust ou na distribuição desktop, execute também:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build
```

## Interface

- Os PNGs em `assets/` são referências de design e nunca devem ser usados como telas, backgrounds ou atalhos visuais.
- Siga literalmente o design system documentado no `README.md`.
- Não adicione áudio ou microfone; o produto compartilha tela, não voz.
- Não introduza framework visual ou valores de cor, radius e sombra fora do padrão aprovado.
- Inclua capturas do resultado no PR quando a mudança for visual.

## Segurança e escopo

- Nunca envie `.env`, tokens, segredos OAuth, credenciais TURN ou dados pessoais ao repositório.
- Diferencie claramente comportamento local, mock e funcionalidade integrada.
- Não implemente Firestore, WebRTC, TURN ou serviços remotos em uma issue que não os inclua.
- Dependências novas precisam ter propósito descrito no PR.

## Organização das tarefas

- O número da issue (`#1`, `#2`, `#3`...) é o identificador da tarefa. O projeto não usa milestones `v0.1`, `v0.2` ou similares durante esta fase inicial.
- Toda tarefa deve declarar contexto, objetivo, escopo permitido, itens que não podem ser alterados, critérios de aceite, validação e dependências.
- Uma IA deve ler integralmente a issue, este arquivo e o `README.md` antes de alterar código. Ela não pode aproveitar uma tarefa para redesenhar a interface, trocar a stack ou refatorar módulos não relacionados.
- Alterações de frontend não implementam serviços remotos. Alterações de backend não modificam componentes, CSS ou tokens visuais.
- A estratégia aprovada para travessia de NAT é TURN. Credenciais TURN devem ser temporárias e emitidas pelo backend; nenhum segredo mestre pode ser incluído no cliente ou no Git.
- O ScreenShare não possui áudio ou microfone.

## Commits e pull requests

Use mensagens objetivas no imperativo ou no padrão Conventional Commits:

```text
feat(auth): add desktop OAuth callback
fix(ui): prevent opacity flicker on hover
docs: document Windows build requirements
```

No PR, explique o problema, a solução, como foi validada e riscos ou pendências. Vincule cada issue concluída com uma linha `Closes #123` (uma por issue, se o PR fechar mais de uma) quando o PR realmente concluir todos os critérios de aceite dela.
