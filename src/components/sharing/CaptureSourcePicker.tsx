import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { captureThumbnail, listCaptureSources, type CaptureQuality, type CaptureSource, type CaptureSourceKind } from "../../services/captureClient";

const QUALITY_OPTIONS: { value: CaptureQuality; label: string }[] = [
  { value: "hd1080", label: "1080p" },
  { value: "hd720", label: "720p" },
  { value: "auto", label: "automatico" },
];

const TABS: { value: CaptureSourceKind; label: string }[] = [
  { value: "window", label: "janelas" },
  { value: "monitor", label: "tela inteira" },
];

/** Um card do grid — busca a própria miniatura (issue #18/#72) de forma
 * independente dos outros, então uma fonte lenta/travada não atrasa as
 * demais. Nunca mostra mock: se a miniatura falhar, mostra o rótulo puro em
 * vez de fingir uma imagem. */
function CaptureSourceCard({ source, selected, onSelect }: { source: CaptureSource; selected: boolean; onSelect: () => void }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    captureThumbnail(source.id).then(
      base64 => { if (!cancelled) setThumbnail(base64); },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [source.id]);

  return (
    <button type="button" className={`capture-source-card ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className="capture-source-card__thumb">
        {thumbnail ? (
          <img src={`data:image/jpeg;base64,${thumbnail}`} alt="" />
        ) : failed ? (
          <span className="capture-source-card__fallback muted">sem previa</span>
        ) : (
          <span className="capture-source-card__fallback">
            <span className="cursor cursor--blink" aria-hidden="true" />
          </span>
        )}
      </span>
      <span className="capture-source-card__label">{source.label}</span>
    </button>
  );
}

/**
 * Seletor de fonte + qualidade + áudio (issue #18/#72) — abas
 * "janelas"/"tela inteira" e grid de 2 colunas com miniatura real, no
 * espírito do seletor do Discord (referência dada pelo usuário) mas com a
 * cara do ScreenShare — nunca o diálogo nativo do navegador/SO. Busca
 * fontes reais via `list_capture_sources` toda vez que abre; nunca mostra
 * mock.
 */
export function CaptureSourcePicker({
  open,
  onClose,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (sourceId: string, quality: CaptureQuality, audioEnabled: boolean) => void;
}) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<CaptureSourceKind>("window");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quality, setQuality] = useState<CaptureQuality>("hd1080");
  const [audioEnabled, setAudioEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");
    setSelectedId(null);
    setTab("window");
    listCaptureSources().then(
      list => { if (!cancelled) { setSources(list); setStatus("ready"); } },
      err => { if (!cancelled) { setError(err instanceof Error ? err.message : "nao foi possivel listar as fontes"); setStatus("error"); } },
    );
    return () => { cancelled = true; };
  }, [open]);

  const visible = sources.filter(source => source.kind === tab);

  return (
    <Modal open={open} onClose={onClose} panelClassName="modal-panel--wide">
      <div className="form-card form-card--modal capture-picker">
        <h2>compartilhar tela</h2>
        <div className="capture-tabs" role="tablist">
          {TABS.map(item => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              className={`capture-tab ${tab === item.value ? "is-active" : ""}`}
              onClick={() => { setTab(item.value); setSelectedId(null); }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {status === "loading" ? <p className="muted">procurando telas e janelas...</p> : null}
        {status === "error" ? <p role="alert" className="auth-status">{error}</p> : null}
        {status === "ready" && visible.length === 0 ? <p className="muted">nenhuma fonte disponivel nesta categoria</p> : null}
        {status === "ready" && visible.length > 0 ? (
          <div className="capture-source-grid">
            {visible.map(source => (
              <CaptureSourceCard key={source.id} source={source} selected={selectedId === source.id} onSelect={() => setSelectedId(source.id)} />
            ))}
          </div>
        ) : null}
        {status === "ready" ? (
          <>
            <div className="capture-footer">
              <div className="capture-quality-list">
                {QUALITY_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={`capture-quality-item ${quality === option.value ? "is-selected" : ""}`}
                    onClick={() => setQuality(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="capture-audio-toggle">
                <input type="checkbox" checked={audioEnabled} onChange={event => setAudioEnabled(event.target.checked)} />
                <span>compartilhar som do sistema</span>
              </label>
            </div>
            <Button wide disabled={!selectedId} onClick={() => selectedId && onStart(selectedId, quality, audioEnabled)}>
              {'>'} iniciar
            </Button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
