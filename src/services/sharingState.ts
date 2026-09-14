/**
 * Sinal global leve de "captura de tela ativa" (issue #8) — a `PixelWave`
 * decorativa vive no `AppShell` (envolve todas as rotas), mas quem sabe se
 * a captura está ativa é o `useLocalCapture`, dentro de `Share.tsx`. Em vez
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
