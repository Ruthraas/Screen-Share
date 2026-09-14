# Como hospedar o backend em produção (issue #82)

Decisão registrada em `docs/backend/ARQUITETURA.md`: **Fly.io + um Volume
persistente**. Este documento é o passo a passo prático — a parte de criar
conta e autenticar só você consegue fazer (o Claude não cria contas em
serviço nenhum).

## 0. Antes de começar

Você vai precisar, à mão, dos valores que já estão no seu
`backend/.env` local: `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`,
`DISCORD_CLIENT_ID`/`SECRET` (os que já configurou), `TURN_KEY_ID`,
`TURN_KEY_API_TOKEN`. **Não me cole esses valores no chat** — copie direto
do arquivo pros comandos abaixo.

`SESSION_SIGNING_SECRET` e `PASSWORD_PEPPER` de produção devem ser
**novos**, diferentes dos que você usa local — os comandos abaixo já geram
valores aleatórios na hora, sem precisar digitar nada.

## 1. Instalar e autenticar o flyctl

```powershell
iwr https://fly.io/install.ps1 -useb | iex
fly auth login
```

Isso abre o navegador pra criar conta/logar (grátis, não pede cartão pra
só usar o Always Free / faixa gratuita de compute).

## 2. Criar o app e o volume

Rodar de dentro de `backend/` (onde já estão `fly.toml` e `Dockerfile`,
commitados neste PR):

```powershell
cd backend
fly apps create screenshare-backend
```

Se o nome já estiver em uso, o comando avisa — escolha outro (ex.
`screenshare-backend-<algo>`) e **atualize a linha `app = "..."` em
`fly.toml`** pra bater com o nome real antes de continuar.

```powershell
fly volumes create screenshare_data --region gru --size 1
```

`--region` precisa bater com `primary_region` do `fly.toml` (`gru` =
São Paulo; troque os dois juntos se preferir outra região). `--size 1` é
1 GB — sobra bastante pra um SQLite de grupos privados pequenos; dá pra
aumentar depois sem downtime (`fly volumes extend`).

## 3. Configurar os secrets

Rodando de dentro de `backend/`. Primeiro gere os dois valores novos (cada
um numa variável, evita problema de aspas aninhadas no comando seguinte):

```powershell
$sessionSecret = node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
$passwordPepper = node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"
```

Depois, um comando só. Troque cada `<...>` pelo valor real (copiado do seu
`.env` local):

```powershell
fly secrets set `
  SESSION_SIGNING_SECRET=$sessionSecret `
  PASSWORD_PEPPER=$passwordPepper `
  OAUTH_REDIRECT_BASE_URL=https://screenshare-backend.fly.dev `
  GOOGLE_CLIENT_ID=<do seu .env> `
  GOOGLE_CLIENT_SECRET=<do seu .env> `
  GITHUB_CLIENT_ID=<do seu .env> `
  GITHUB_CLIENT_SECRET=<do seu .env> `
  DISCORD_CLIENT_ID=<do seu .env> `
  DISCORD_CLIENT_SECRET=<do seu .env> `
  TURN_KEY_ID=<do seu .env> `
  TURN_KEY_API_TOKEN=<do seu .env>
```

Ajuste `OAUTH_REDIRECT_BASE_URL` pro domínio real se o nome do app não
foi `screenshare-backend` (passo 2). Só inclua os três pares
`*_CLIENT_ID`/`*_CLIENT_SECRET` dos provedores que você já configurou de
verdade — provedor sem credencial responde erro claro no `/start` dele,
não trava o boot (comportamento já existente, não muda em produção).

`HOST`, `PORT`, `DATABASE_PATH`, `SIGNALING_PATH` **não** entram aqui — já
estão em `fly.toml` (`[env]`), não são segredo.

## 4. Deploy

```powershell
fly deploy
```

Builda a imagem (`Dockerfile`), sobe, monta o volume em `/data`, roda as
migrações automaticamente no boot (mesmo comportamento do `npm start`
local, ver `backend/README.md`).

## 5. Validar (critérios de aceite da issue #82)

```powershell
curl https://screenshare-backend.fly.dev/health
curl https://screenshare-backend.fly.dev/ready
```

Os dois devem responder `200`. Depois:

1. Cadastre uma conta e crie um grupo de teste contra o domínio real
   (Postman, `curl`, ou o próprio app apontando `VITE_API_URL` pra cá —
   combine com o @Ruthraas quando for testar pelo app de verdade).
2. **Force um restart** (`fly machine restart <id>`, id via `fly status`)
   ou um redeploy (`fly deploy` de novo, sem mudar nada) e confirme que a
   conta/grupo **continuam lá** — é a validação obrigatória da issue:
   persistência de verdade, não só "o deploy funcionou".
3. Teste login OAuth de verdade contra o domínio novo (não localhost) —
   ver passo 6 primeiro, senão o provedor rejeita o redirect.

## 6. Atualizar o redirect URI em cada provedor OAuth configurado

**Sem isso, login OAuth quebra em produção mesmo com o backend no ar** —
cada provedor só aceita voltar pra uma URL exatamente cadastrada na
console dele. Pra cada provedor que você configurou (Google/GitHub/
Discord), adicione (sem remover o de desenvolvimento, que continua
funcionando pra rodar local):

```
https://screenshare-backend.fly.dev/v1/auth/oauth/google/callback
https://screenshare-backend.fly.dev/v1/auth/oauth/github/callback
https://screenshare-backend.fly.dev/v1/auth/oauth/discord/callback
```

(troque `screenshare-backend.fly.dev` pelo domínio real se for diferente;
adicione só os provedores que você realmente usa).

## 7. Depois do backend no ar

- Avisar o @Ruthraas pra apontar `VITE_API_URL` (frontend) pro domínio
  real — fora do escopo desta issue, é o lado dele.
- Isso desbloqueia o primeiro release real (`v1.0.0`) de verdade — ver
  `docs/backend/RELEASES.md`.
- **Nunca rode `fly scale count` acima de 1** nesta app — SQLite não
  aguenta duas máquinas escrevendo no mesmo arquivo ao mesmo tempo, e o
  volume é preso a uma única máquina de qualquer forma.

## Se os limites gratuitos não servirem na prática

Ver a opção 3 (migrar pra Turso/libSQL) registrada em
`docs/backend/ARQUITETURA.md` — é o próximo passo natural, não gambiarra:
tira a dependência de disco anexado e libera qualquer hospedagem grátis
simples, não só Fly.
