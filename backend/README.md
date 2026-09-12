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
de sair, para não deixar conexões pendentes. `app.close()` em si é coberto
pelos testes automatizados (fecha sem pendências a cada teste). A entrega
de sinal ponta a ponta (`SIGINT`/`SIGTERM` → handler → `app.close()`) é
padrão em Node.js e funciona como esperado em Linux/produção; **no Windows,
o próprio Node não expõe esses sinais de forma confiável para o processo**
(o SO encerra o processo diretamente em vez de emitir o evento), então esse
caminho específico não pôde ser validado ponta a ponta neste ambiente de
desenvolvimento — só o comportamento de `app.close()` em si.
