import { Button } from "../ui/Button";
import { IconAlertTriangle, IconDownload, IconX } from "../ui/Icons";
import { useUpdate } from "./UpdateProvider";
import { summarizeDownloadProgress, summarizeReleaseNotes } from "./updateFormat";

/**
 * Aviso de atualização disponível (issue #48) — banner, nunca modal: o
 * app continua 100% usável com ele na tela (critério de aceite "usuário
 * pode adiar sem travar o aplicativo"). Fica escondido em `idle`/
 * `checking`/`dismissed` — checar sozinho não deveria gerar ruído visual,
 * só quando há algo pra decidir.
 */
export function UpdateBanner() {
  const { state, startUpdate, dismiss, retry } = useUpdate();

  if (state.status === "idle" || state.status === "checking" || state.status === "dismissed") return null;

  if (state.status === "available") {
    const notes = summarizeReleaseNotes(state.notes);
    return (
      <div className="update-banner" role="status" aria-live="polite">
        <IconDownload />
        <div className="update-banner__text">
          <strong>versao {state.version} disponivel</strong>
          {notes ? <span>{notes}</span> : null}
        </div>
        <Button onClick={() => void startUpdate()}>{'>'} atualizar</Button>
        <button className="update-banner__dismiss" onClick={dismiss} aria-label="adiar atualizacao" title="adiar"><IconX /></button>
      </div>
    );
  }

  if (state.status === "downloading") {
    const progress = summarizeDownloadProgress(state.progress.downloadedBytes, state.progress.totalBytes);
    return (
      <div className="update-banner" role="status" aria-live="polite">
        <IconDownload />
        <div className="update-banner__text">
          <strong>baixando versao {state.version}</strong>
          <span>{progress.label}</span>
          <span className="update-banner__bar">
            <span className="update-banner__bar-fill" style={{ width: progress.percent === null ? "100%" : `${progress.percent}%` }} />
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="update-banner update-banner--error" role="alert">
      <IconAlertTriangle />
      <div className="update-banner__text">
        <strong>{state.message}</strong>
      </div>
      <Button variant="ghost" onClick={retry}>tentar de novo</Button>
      <button className="update-banner__dismiss" onClick={dismiss} aria-label="fechar aviso" title="fechar"><IconX /></button>
    </div>
  );
}
