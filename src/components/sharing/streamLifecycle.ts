export interface StreamLike {
  addEventListener(type: "inactive", listener: () => void): void;
  removeEventListener(type: "inactive", listener: () => void): void;
}

/**
 * Observa o fim de um MediaStream (evento nativo `inactive`, disparado
 * quando todos os tracks terminam — ex.: usuário clica "parar
 * compartilhamento" no diálogo nativo do navegador/SO) e devolve a função
 * de limpeza. Isolado do React/DOM pra dar pra testar com um `EventTarget`
 * simulado em vez de precisar de um `MediaStream` de verdade (issue #19,
 * "estado encerrado").
 */
export function watchStreamEnded(stream: StreamLike | null | undefined, onEnded: () => void): () => void {
  if (!stream) return () => {};
  stream.addEventListener("inactive", onEnded);
  return () => stream.removeEventListener("inactive", onEnded);
}
