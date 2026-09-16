import { useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, downloadAndInstallUpdate, type DownloadProgress } from "../../services/updateClient";
import { log } from "../../services/logger";

/** Espera um pouco depois do app abrir antes de checar — issue #48 pede
 * "sem bloquear o app", e checar update não deveria competir com o login/
 * carregamento inicial de grupos pela rede. */
const CHECK_DELAY_MS = 4000;

export type AppUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string; currentVersion: string; notes?: string }
  | { status: "downloading"; version: string; progress: DownloadProgress }
  | { status: "error"; message: string }
  | { status: "dismissed" };

/**
 * Ciclo de vida de verificação/instalação de atualização (issue #48) — só
 * checa UMA vez por sessão (guarda em ref, não repete a cada navegação de
 * rota nem remount de página; só reseta se o provider em si remontar, ex.
 * logout/login de novo). Nunca trava o app: toda falha vira um estado
 * `error` recuperável (retry via `startUpdate`/`checkNow`), e o
 * componente que consome isto decide se/como mostrar — pode sempre ser
 * dispensado (`dismiss`).
 */
export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({ status: "idle" });
  const updateRef = useRef<Update | null>(null);
  const checkedRef = useRef(false);
  // Qual das duas etapas falhou por último — `retry()` (única ação
  // exposta pro estado "error") precisa saber se repete o check ou volta
  // pro download; um `Update` já resolvido continua válido em
  // `updateRef`, não precisa checar de novo se foi só o download que
  // falhou.
  const lastFailedActionRef = useRef<"check" | "download">("check");

  async function checkNow() {
    setState({ status: "checking" });
    try {
      const result = await checkForUpdate();
      if (!result) {
        setState({ status: "idle" });
        return;
      }
      updateRef.current = result.update;
      setState({ status: "available", version: result.info.version, currentVersion: result.info.currentVersion, notes: result.info.notes });
    } catch (error) {
      log.warn("update", "falha ao verificar atualizacao", { name: error instanceof Error ? error.name : "unknown" });
      lastFailedActionRef.current = "check";
      setState({ status: "error", message: "nao foi possivel verificar atualizacoes" });
    }
  }

  useEffect(() => {
    // A guarda de "so uma vez" tem que ficar DENTRO do timeout, nao no
    // corpo sincrono do effect — achado real testando: o StrictMode do
    // React (dev) monta/desmonta/remonta o effect na hora; a versao
    // antiga marcava `checkedRef` e agendava o timer no primeiro mount, o
    // cleanup do desmonte cancelava esse timer, e o remonte via
    // `checkedRef` ja true nunca reagendava nada — o check nunca rodava
    // de verdade em dev. Assim, o timer cancelado pelo StrictMode nunca
    // chega a marcar `checkedRef`, entao o segundo mount agenda um novo
    // timer que sobrevive; em producao (sem esse remonte artificial) só
    // um timer é agendado de qualquer forma.
    const timer = setTimeout(() => {
      if (checkedRef.current) return;
      checkedRef.current = true;
      void checkNow();
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  async function startUpdate() {
    const update = updateRef.current;
    if (!update) return;
    setState({ status: "downloading", version: update.version, progress: { downloadedBytes: 0, totalBytes: null } });
    try {
      await downloadAndInstallUpdate(update, progress => {
        setState({ status: "downloading", version: update.version, progress });
      });
      // No Windows o instalador ja fecha o app aqui (issue #48: "instala
      // e reinicia") — se a promise resolver sem o processo ter saido,
      // nao ha nada mais a fazer do lado do cliente.
    } catch (error) {
      log.warn("update", "falha ao baixar/instalar atualizacao", { name: error instanceof Error ? error.name : "unknown" });
      lastFailedActionRef.current = "download";
      setState({ status: "error", message: "falha ao instalar a atualizacao. tente novamente" });
    }
  }

  function dismiss() {
    setState({ status: "dismissed" });
  }

  function retry() {
    if (lastFailedActionRef.current === "download" && updateRef.current) void startUpdate();
    else void checkNow();
  }

  return { state, startUpdate, dismiss, retry, check: () => void checkNow() };
}
