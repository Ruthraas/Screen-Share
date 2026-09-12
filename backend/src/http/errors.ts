export interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlationId: string;
  };
}

/**
 * Envelope de erro único usado por todas as rotas HTTP (docs/backend/openapi.yaml,
 * schema Error). `code` é estável e machine-readable; `message` é pt-BR
 * seguro para exibir; `correlationId` correlaciona com os logs (issue #44)
 * e nunca deve conter dado sensível.
 */
export function errorBody(code: string, message: string, correlationId: string): ErrorBody {
  return { error: { code, message, correlationId } };
}
