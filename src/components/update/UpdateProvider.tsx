import { createContext, useContext, type ReactNode } from "react";
import { useAppUpdate } from "./useAppUpdate";

type UpdateContextValue = ReturnType<typeof useAppUpdate>;
const Context = createContext<UpdateContextValue | null>(null);

/** Estado de atualização (issue #48) compartilhado entre o botão da
 * sidebar (`UpdateCheckButton`) e o banner (`UpdateBanner`) — precisam da
 * MESMA instância do hook (não uma cada) pra clicar no ícone e ver o
 * banner aparecer depois, em vez de cada um checar por conta própria. */
export function useUpdate(): UpdateContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("update-provider-required");
  return value;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const value = useAppUpdate();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
