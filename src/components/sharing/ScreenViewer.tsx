import { useEffect, useRef } from "react";
import type { User } from "../../data/types";
import { Avatar } from "../ui/Avatar";
import { IconMinimize } from "../ui/Icons";
import { log } from "../../services/logger";
import { watchStreamEnded } from "./streamLifecycle";

export function ScreenViewer({
  user,
  members = [],
  stream,
  onMinimize,
  onSelect,
  onStreamEnded,
}: {
  user: User;
  members?: User[];
  stream?: MediaStream;
  onMinimize: () => void;
  onSelect?: (user: User) => void;
  /** Dispara quando o stream termina sozinho (issue #19: "estado
   * encerrado") — ex. usuário para o compartilhamento pelo diálogo nativo
   * do navegador/SO, sem passar pelos controles do app. Quem usa este
   * componente decide o que fazer (normalmente: limpar o `stream` do
   * estado, o placeholder volta a aparecer sozinho). */
  onStreamEnded?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);

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
    <section className="screen-viewer" aria-label={"tela de " + user.name}>
      <div className="stream-stage">
        {stream ? (
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            onError={() => log.warn("capture", "elemento de video reportou erro de reproducao")}
          />
        ) : (
          <div className="stream-placeholder" />
        )}
        <span className="viewer-label">{user.name}</span>
        <button className="viewer-minimize nav-button" title="minimizar" onClick={onMinimize}><IconMinimize /></button>
      </div>
      <aside className="viewer-members">
        {members.map(member => (
          <button key={member.id} title={member.name} className={"viewer-member " + (member.current ? "is-current" : "")} onClick={() => onSelect?.(member)}>
            <Avatar user={member} size="sm" />
            <span>{member.name}</span>
          </button>
        ))}
      </aside>
    </section>
  );
}
