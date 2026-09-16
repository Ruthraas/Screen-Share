import { useEffect, useRef, useState } from "react";
import type { User } from "../../data/types";
import { Avatar } from "../ui/Avatar";
import { IconEye, IconMaximize, IconMinimize, IconPlayerStop, IconVolume, IconVolumeOff } from "../ui/Icons";
import { log } from "../../services/logger";
import { watchStreamEnded } from "./streamLifecycle";

/** Tela cheia de verdade (Fullscreen API do navegador/WebView2), não só CSS
 * ocupando a janela — pedido do usuário: a transmissão precisa ser algo
 * único que dá pra colocar em tela cheia de fato. `document.fullscreenElement`
 * é a fonte de verdade (não um estado local isolado): o usuário pode sair
 * apertando Esc sem passar pelo botão, e o listener de `fullscreenchange`
 * mantém o ícone/estado corretos nesse caso também. */
function useFullscreen(target: React.RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement === target.current);
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [target]);

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await target.current?.requestFullscreen();
    } catch (error) {
      log.warn("capture", "falha ao alternar tela cheia", { name: error instanceof Error ? error.name : "unknown" });
    }
  }

  return { isFullscreen, toggle };
}

export function ScreenViewer({
  user,
  members = [],
  stream,
  loading = false,
  emptyMessage,
  onStop,
  onSelect,
  onStreamEnded,
}: {
  /** Quem está sendo visto — opcional pra dar pra montar este componente
   * mesmo sem ninguém selecionado ainda (a sidebar de membros continua
   * visível, o palco central mostra `emptyMessage` no lugar do vídeo). */
  user?: User;
  members?: User[];
  stream?: MediaStream;
  /** Existe um intervalo real entre a captura iniciar e o primeiro frame de
   * verdade chegar — sem indicar isso, a tela em branco parece travada em
   * vez de carregando (issue #8, pedido do usuário). */
  loading?: boolean;
  /** Texto mostrado no palco quando não há `stream` (ninguém selecionado,
   * ou conectando ainda) — quem chama decide a mensagem certa pro estado. */
  emptyMessage?: string;
  /** Para a captura de verdade (não é um "minimizar": ainda não existe
   * modo PiP/segundo plano, então o botão precisa deixar claro que
   * encerra a transmissão, não só esconde a janela). Só faz sentido (e só
   * é mostrado) quando existe um `stream` de verdade. */
  onStop?: () => void;
  onSelect?: (user: User) => void;
  /** Dispara quando o stream termina sozinho (issue #19: "estado
   * encerrado") — ex. usuário para o compartilhamento pelo diálogo nativo
   * do navegador/SO, sem passar pelos controles do app. Quem usa este
   * componente decide o que fazer (normalmente: limpar o `stream` do
   * estado, o placeholder volta a aparecer sozinho). */
  onStreamEnded?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const section = useRef<HTMLElement>(null);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(section);
  // Botão "ver tela" (pedido do usuário) — só na visualização principal da
  // transmissão, nunca nos cards de prévia do seletor. O vídeo continua
  // recebendo frames em segundo plano (não pausa nada); é só um gesto
  // explícito antes de mostrar, em vez de aparecer sozinho assim que o
  // primeiro frame chega. Reseta sempre que uma transmissão nova começa.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!stream) setRevealed(false);
  }, [stream]);

  // Volume/mute (pedido do usuário: "ferramentas de abaixar volume") —
  // começa mudo de propósito, mesmo default que todo player de vídeo usa
  // (autoplay com som costuma ser bloqueado pela política do WebView2/
  // navegador de qualquer forma; o usuário liga quando quiser).
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  useEffect(() => {
    const element = video.current;
    if (element) {
      element.muted = muted;
      element.volume = volume;
    }
  }, [muted, volume, stream]);

  useEffect(() => {
    const element = video.current;
    if (element) {
      element.srcObject = stream ?? null;
      if (stream) {
        // autoPlay já cobre o caso feliz; chamar play() explicitamente só
        // pra ter uma promise que dá pra capturar e logar quando falha
        // (ex.: politica de autoplay do WebView2 rejeitando) — issue #23,
        // "falhas de captura".
        element.play().catch(error => {
          log.warn("capture", "falha ao iniciar reproducao do stream", { name: error?.name });
        });
      }
    }
    const stopWatching = watchStreamEnded(stream, () => {
      log.warn("capture", "stream encerrado de forma inesperada (fora dos controles do app)");
      onStreamEnded?.();
    });
    return () => {
      stopWatching();
      if (element) element.srcObject = null;
    };
  }, [stream, onStreamEnded]);

  return (
    <section ref={section} className={`screen-viewer ${members.length === 0 ? "screen-viewer--solo" : ""} ${isFullscreen ? "is-fullscreen" : ""}`} aria-label={user ? "tela de " + user.name : "nenhuma transmissao selecionada"}>
      <div className="stream-stage">
        {stream ? (
          <video
            ref={video}
            autoPlay
            playsInline
            className={revealed ? "" : "is-hidden-until-revealed"}
            onError={() => log.warn("capture", "elemento de video reportou erro de reproducao")}
          />
        ) : (
          <div className="stream-placeholder">
            {emptyMessage ? <p className="muted">{emptyMessage}</p> : null}
          </div>
        )}
        {stream && loading ? (
          <div className="stream-loading">
            <span className="cursor cursor--blink" aria-hidden="true" />
            <span>carregando tela</span>
          </div>
        ) : null}
        {stream && !loading && !revealed ? (
          <div className="stream-reveal">
            <button className="stream-reveal__button" onClick={() => setRevealed(true)}>
              <IconEye />
              <span>ver tela</span>
            </button>
          </div>
        ) : null}
        {stream && user ? <span className="viewer-label">{user.name}</span> : null}
        {stream ? (
          <div className="viewer-actions">
            <div className="viewer-volume">
              <button className="nav-button" title={muted ? "ativar som" : "silenciar"} onClick={() => setMuted(m => !m)}>
                {muted || volume === 0 ? <IconVolumeOff /> : <IconVolume />}
              </button>
              <input
                type="range"
                className="viewer-volume__slider"
                aria-label="volume"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={event => {
                  const next = Number(event.target.value);
                  setVolume(next);
                  setMuted(next === 0);
                }}
              />
            </div>
            <button className="nav-button" title={isFullscreen ? "sair da tela cheia" : "tela cheia"} onClick={() => void toggleFullscreen()}>
              {isFullscreen ? <IconMinimize /> : <IconMaximize />}
            </button>
            {onStop ? <button className="nav-button" title="parar transmissao" onClick={onStop}><IconPlayerStop /></button> : null}
          </div>
        ) : null}
      </div>
      {members.length > 0 ? (
        <aside className="viewer-members">
          {members.map(member => (
            <button key={member.id} title={member.name} className={"viewer-member " + (member.current ? "is-current" : "") + (member.sharing ? " is-live" : "")} onClick={() => onSelect?.(member)}>
              {member.sharing ? <span className="live-dot" /> : null}
              <Avatar user={member} size="sm" />
              <span>{member.name}</span>
            </button>
          ))}
        </aside>
      ) : null}
    </section>
  );
}
