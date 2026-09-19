import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount } from "../layout/AccountProvider";
import { getLocalStream, subscribeLocalStream } from "../../services/sharingState";
import { useGroupConnections } from "./useGroupConnections";

type RtcState = ReturnType<typeof useGroupConnections>;

const Context = createContext<RtcState | null>(null);

/** Estado das conexões WebRTC do grupo selecionado (issue #71) — leitura em
 * qualquer página sem prop-drilling (mesmo motivo de `sharingState.ts`: a
 * conexão precisa continuar viva mesmo trocando de rota). */
export function useRtc(): RtcState {
  const value = useContext(Context);
  if (!value) throw new Error("rtc-provider-required");
  return value;
}

/**
 * Mantém UMA sessão de sinalização + malha de `RTCPeerConnection` por grupo
 * selecionado, viva enquanto a conta estiver logada — independente de qual
 * página está sendo exibida no momento. Local do provider: dentro de
 * `AccountProvider` (precisa de `selected`/`user`), envolvendo as rotas.
 */
export function RtcProvider({ children }: { children: ReactNode }) {
  const { selected, user } = useAccount();
  const [localStream, setLocalStream] = useState<MediaStream | null>(() => getLocalStream());

  useEffect(() => subscribeLocalStream(setLocalStream), []);

  const state = useGroupConnections(selected?.id, user.id, localStream);

  return <Context.Provider value={state}>{children}</Context.Provider>;
}
