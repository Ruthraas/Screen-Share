# ScreenShare backend — imagem de produção (issue #82).
#
# node:*-bookworm-slim (Debian, glibc) de propósito, não Alpine: o
# better-sqlite3 só publica binário pré-compilado pra libc glibc (ver
# backend/README.md, issue #58) — Alpine usa musl e forçaria compilar do
# zero dentro do build (Python + toolchain C++, que o .npmrc
# deliberadamente evita).
#
# Dois estágios: o primeiro instala tudo (incl. devDependencies, pra ter
# o `tsc`) e builda; o segundo reinstala só as dependências de produção e
# copia apenas dist/ + migrations/ — imagem final não carrega TypeScript,
# fonte nem devDependencies.

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations

# DATABASE_PATH (via fly.toml/[env]) deve apontar pra dentro do volume
# persistente montado em produção — nunca pra dentro de /app, que é
# recriado a cada deploy. As migrações rodam sozinhas no boot
# (src/index.ts), não precisa de passo extra aqui.
EXPOSE 8787
CMD ["node", "dist/index.js"]
