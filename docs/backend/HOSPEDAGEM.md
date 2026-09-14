# Como hospedar o backend em produção (issue #82)

Decisão registrada em `docs/backend/ARQUITETURA.md`: **Render, serviço Node
nativo (sem Docker), Blueprint via `render.yaml`** na raiz do repositório.
Isso só é possível porque o backend virou sem estado na migração pro Turso —
sem disco a persistir, qualquer hospedagem simples de processo serve. Este
documento é o passo a passo prático — a parte de criar conta e autorizar o
GitHub só você consegue fazer (o Claude não cria contas em serviço nenhum).

## 0. Antes de começar

Tenha à mão os valores que já estão no seu `backend/.env` local:
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `TURN_KEY_ID`,
`TURN_KEY_API_TOKEN`, e os `*_CLIENT_ID`/`*_CLIENT_SECRET` dos provedores
OAuth que já configurou. **Não cole esses valores no chat** — copie direto
do arquivo pro formulário do Render.

`SESSION_SIGNING_SECRET` e `PASSWORD_PEPPER` de produção devem ser **novos**,
diferentes dos que você usa local. Gere cada um assim (PowerShell) antes de
ir pro passo 2:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```

## 1. Criar conta e conectar o repositório

1. Entre em [render.com](https://render.com), crie a conta (dá pra usar
   login do GitHub direto, simplifica o passo seguinte).
2. **New +** → **Blueprint**.
3. Autorize o Render a acessar o repositório `Ruthraas/Screen-Share` (só
   este repo, não a conta inteira, se o GitHub oferecer essa opção).
4. O Render encontra `render.yaml` sozinho (está na raiz do repo) e mostra
   o serviço `screenshare-backend` que ele vai criar, com a lista de
   variáveis de ambiente pedindo valor (todas as que têm `sync: false` no
   arquivo).

## 2. Preencher as variáveis de ambiente

Preencha com os valores do seu `.env` local:

| Variável | Origem |
|---|---|
| `TURSO_DATABASE_URL` | `.env` local |
| `TURSO_AUTH_TOKEN` | `.env` local |
| `SESSION_SIGNING_SECRET` | **novo**, gerado no passo 0 |
| `PASSWORD_PEPPER` | **novo**, gerado no passo 0 |
| `TURN_KEY_ID` | `.env` local |
| `TURN_KEY_API_TOKEN` | `.env` local |
| `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`, `DISCORD_CLIENT_ID`/`SECRET` | `.env` local — só os provedores que você já configurou; deixe os outros em branco |
| `CORS_ALLOWED_ORIGINS`, `OAUTH_FRONTEND_REDIRECT_URL_BROWSER`, `OAUTH_FRONTEND_REDIRECT_URL_DESKTOP` | deixe em branco por enquanto — `src/config.ts` já tem default seguro pro cliente empacotado |

**`OAUTH_REDIRECT_BASE_URL` ainda não dá pra preencher** — depende da URL
que o Render só mostra depois de criar o serviço (formato
`https://screenshare-backend.onrender.com`, ou um sufixo diferente se o
nome já estiver em uso). Deixe em branco por ora, você volta no passo 4.

Clique em **Deploy Blueprint**.

## 3. Primeiro deploy

O Render builda (`npm ci && npm run build`) e sobe (`npm start`) sozinho.
As migrações rodam automaticamente no boot (`src/index.ts`, mesmo
comportamento do `npm start` local) — não precisa de passo manual.

Acompanhe o log de build/deploy no dashboard. Ao terminar, o Render mostra
a URL pública do serviço no topo da página (ex.:
`https://screenshare-backend.onrender.com`).

## 4. Completar `OAUTH_REDIRECT_BASE_URL` com a URL real

Na aba **Environment** do serviço, edite `OAUTH_REDIRECT_BASE_URL` pra URL
que o Render te deu no passo 3 (sem barra no final). Salvar dispara um
redeploy automático — normal, é rápido (sem build, só reinicia o processo
com a env nova).

## 5. Validar (critérios de aceite da issue #82)

```powershell
curl https://screenshare-backend.onrender.com/health
curl https://screenshare-backend.onrender.com/ready
```

Os dois devem responder `200`. Depois:

1. Cadastre uma conta e crie um grupo de teste contra o domínio real
   (Postman, `curl`, ou o próprio app apontando `VITE_API_URL` pra cá —
   combine com o @Ruthraas quando for testar pelo app de verdade).
2. **Force um redeploy manual** (aba do serviço → "Manual Deploy" → "Deploy
   latest commit") e confirme que a conta/grupo **continuam lá** — é a
   validação obrigatória da issue: persistência de verdade (agora no
   Turso, não no processo do Render), não só "o deploy funcionou".
3. Teste login OAuth de verdade contra o domínio novo (não localhost) —
   ver passo 6 primeiro, senão o provedor rejeita o redirect.

## 6. Atualizar o redirect URI em cada provedor OAuth configurado

**Sem isso, login OAuth quebra em produção mesmo com o backend no ar** —
cada provedor só aceita voltar pra uma URL exatamente cadastrada na console
dele. Pra cada provedor que você configurou (Google/GitHub/Discord),
adicione (sem remover o de desenvolvimento, que continua funcionando pra
rodar local):

```
https://screenshare-backend.onrender.com/v1/auth/oauth/google/callback
https://screenshare-backend.onrender.com/v1/auth/oauth/github/callback
https://screenshare-backend.onrender.com/v1/auth/oauth/discord/callback
```

(troque `screenshare-backend.onrender.com` pelo domínio real se for
diferente; adicione só os provedores que você realmente usa).

## 7. Depois do backend no ar

- Avisar o @Ruthraas pra apontar `VITE_API_URL` (frontend) pro domínio
  real — fora do escopo desta issue, é o lado dele.
- Isso desbloqueia o primeiro release real (`v1.0.0`) de verdade — ver
  `docs/backend/RELEASES.md`.

## Uma limitação real do plano grátis do Render (leia antes de confiar 100%)

O plano `free` **suspende o serviço depois de ~15 minutos sem nenhuma
requisição** — a próxima requisição recebe um "cold start" de dezenas de
segundos até o processo voltar. Isso não afeta uma sessão de
compartilhamento de tela já em andamento (o WebSocket de sinalização, uma
vez conectado, mantém o serviço ativo), só o primeiro acesso depois de um
período ocioso — o usuário pode notar demora ao tentar entrar num grupo
depois de o serviço ter "dormido". Aceitável pro tamanho atual do produto
(grupo de amigos, não uso constante 24/7); se isso incomodar na prática, a
correção é upgrade de plano (`starter` em diante, sem suspensão), não
trocar de hospedagem de novo.
