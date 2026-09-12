# ScreenShare Backend

Serviço remoto do ScreenShare — HTTP (Fastify) + WebSocket (a partir da
issue #37). Não roda dentro do processo Tauri; é implantado e executado
separadamente. Ver [`docs/backend/ARQUITETURA.md`](../docs/backend/ARQUITETURA.md)
para a decisão de stack e [`docs/backend/openapi.yaml`](../docs/backend/openapi.yaml)
para o contrato HTTP.

## Requisitos

- Node.js 20+

## Comandos

```powershell
cd backend
npm install

# desenvolvimento (reinicia ao salvar)
npm run dev

# build de produção
npm run build
npm start

# testes
npm test
```

Por padrão o serviço escuta em `0.0.0.0:8787`. Ajuste com as variáveis de
ambiente `HOST` e `PORT`.

## Endpoints disponíveis nesta etapa (#28)

- `GET /health` → `200 { "status": "ok" }`. Ainda não há regra de produto,
  autenticação ou persistência — isso chega nas issues seguintes (#29 a
  #44 conforme `docs/BACKEND.md`).

## Encerramento

O processo trata `SIGINT`/`SIGTERM`: fecha o Fastify (`app.close()`) antes
de sair, para não deixar conexões pendentes.
