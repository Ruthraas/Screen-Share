# Como cortar uma release (issue #49)

## Pré-requisito único, feito uma vez

O workflow assina os artefatos de update com uma chave Ed25519 (par
gerado com `tauri signer generate`, formato minisign). A chave **pública**
já está em `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) — isso é
seguro de ter no repositório, é só o que o updater usa pra *verificar*
assinatura, não pra assinar.

A chave **privada** nunca entra no Git. Ela precisa estar configurada como
secret do repositório antes do primeiro release real:

- `Settings → Secrets and variables → Actions → New repository secret`
- `TAURI_SIGNING_PRIVATE_KEY` — conteúdo do arquivo `.key` gerado
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — senha definida na geração

(Gerados e entregues fora do Git no PR que introduziu este workflow — ver
`docs/backend/ARQUITETURA.md` pra decisão completa. Se precisar trocar a
chave no futuro — perda, rotação de segurança — gere um novo par com
`npx tauri signer generate`, atualize os dois secrets e o `pubkey` em
`tauri.conf.json` juntos no mesmo PR; trocar só um dos dois quebra a
verificação de updates já publicados com a chave antiga.)

Sem esses dois secrets configurados, o workflow ainda builda e cria a
release, mas o `tauri-action` não consegue assinar — os artefatos saem sem
`.sig`, e a issue #48 (validação de assinatura no cliente) vai rejeitar o
update. Configure antes do primeiro uso real.

## Passo a passo

1. Decida a nova versão (semver: `MAJOR.MINOR.PATCH`).
2. Atualize a versão nos **três** arquivos (precisam bater exatamente,
   sem o `v` do prefixo de tag):
   - `package.json` (`version`)
   - `src-tauri/Cargo.toml` (`[package].version`)
   - `src-tauri/tauri.conf.json` (`version`)
3. Commit e PR normal (`Closes` nenhuma issue — é só um bump de versão,
   a menos que esteja fechando uma feature junto).
4. Depois do merge em `main`, na `main` local atualizada:
   ```bash
   git tag vMAJOR.MINOR.PATCH
   git push origin vMAJOR.MINOR.PATCH
   ```
5. O push da tag dispara `.github/workflows/release.yml` automaticamente.
   Acompanhe em Actions. Se tudo passar, a release aparece publicada
   (não mais rascunho) em alguns minutos, com:
   - `ScreenShare.exe` (binário puro)
   - instalador NSIS (`ScreenShare_<versão>_x64-setup.exe`)
   - `latest.json` (manifesto do updater — issue #48 consome
     `https://github.com/Ruthraas/Screen-Share/releases/latest/download/latest.json`)
   - `checksums.txt` (SHA256 de cada artefato)

## O que interrompe o workflow (de propósito)

- **Versão divergente** entre a tag e qualquer um dos três arquivos —
  falha no primeiro passo, antes de gastar tempo buildando
  (`scripts/verificar-versao-release.mjs`).
- **Testes Rust falhando** (`cargo test --lib`) — sanidade mínima antes
  de publicar algo pros usuários.
- **Falha de build/assinatura/upload** em qualquer ponto — a release fica
  criada como **rascunho** (não aparece pra ninguém, não conta como
  "latest") e só é publicada (`gh release edit --draft=false`) no último
  passo, que só roda se tudo antes passou. Uma release incompleta nunca
  fica visível como estável.

## Testando de verdade

Só dá pra validar ponta a ponta empurrando uma tag real — isso publica
uma release pública de verdade no GitHub. Não é algo pra automatizar sem
decisão explícita de quando (consome o número de versão real do produto).
Depois de rodar: baixe o instalador numa máquina limpa, confira o
checksum contra `checksums.txt`, instale, e confirme que `latest.json`
tem a URL/assinatura certas antes de considerar a issue #48 desbloqueada
de verdade.
