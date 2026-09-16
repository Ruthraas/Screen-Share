/**
 * Sinal global leve de "captura de tela ativa" (issue #8) — a `PixelWave`
 * decorativa vive no `AppShell` (envolve todas as rotas), mas quem sabe se
 * a captura está ativa é o `useLocalCapture`, dentro de `MultiScreen.tsx`. Em vez
 * de prop-drilling por vários componentes só pra isso, segue o mesmo
 * padrão de estado externo assinável já usado em `authClient.ts`
 * (`subscribeSession`).
 */
type Listener = (sharing: boolean) => void;
let sharingActive = false;
const listeners = new Set<Listener>();

export function setSharingActive(value: boolean): void {
  if (sharingActive === value) return;
  sharingActive = value;
  for (const listener of listeners) listener(value);
}

export function getSharingActive(): boolean {
  return sharingActive;
}

export function subscribeSharingActive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * O `MediaStream` local em si (issue #71) — mesmo motivo do sinal booleano
 * acima: `useLocalCapture` fica dentro de `MultiScreen.tsx`, mas quem precisa
 * anexar as tracks a cada `RTCPeerConnection` (`useGroupConnections.ts`)
 * roda num provider acima de qualquer rota especifica, pra continuar
 * mandando a tela mesmo se o usuario navegar pra outra pagina enquanto
 * compartilha.
 */
type StreamListener = (stream: MediaStream | null) => void;
let localStream: MediaStream | null = null;
const streamListeners = new Set<StreamListener>();

export function setLocalStream(value: MediaStream | null): void {
  if (localStream === value) return;
  localStream = value;
  for (const listener of streamListeners) listener(value);
}

export function getLocalStream(): MediaStream | null {
  return localStream;
}

export function subscribeLocalStream(listener: StreamListener): () => void {
  streamListeners.add(listener);
  return () => streamListeners.delete(listener);
}
