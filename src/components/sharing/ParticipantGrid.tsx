import type { User } from "../../data/types";
import { Avatar } from "../ui/Avatar";
import { ConnectionQualityIcon } from "../rtc/ConnectionQualityIcon";

/**
 * "Sala de espera" — grid de participantes mostrado enquanto ninguém está
 * compartilhando a tela (pedido do usuário, inspirado no layout de um app
 * de chamada de um amigo dele, adaptado pro nosso design system: avatar
 * quadrado e sem cor fora da paleta do ScreenShare, nunca uma cópia 1:1).
 * Puramente informativo (sem `onSelect`) — não há transmissão nenhuma pra
 * selecionar nesse estado; assim que alguém começa a compartilhar,
 * `MultiScreen` volta a renderizar o `ScreenViewer` normalmente.
 */
export function ParticipantGrid({ members }: { members: User[] }) {
  return (
    <div className="participant-grid-stage">
      <p className="participant-grid-caption">ninguém está compartilhando a tela agora</p>
      <div className="participant-grid">
        {members.map(member => (
          <div key={member.id} className="participant-card" title={member.name}>
            {member.quality ? <ConnectionQualityIcon quality={member.quality} /> : null}
            <Avatar user={member} size="lg" />
            <span className="participant-card__name">{member.name}</span>
            <span className={`participant-card__status ${member.online ? "is-online" : ""}`}>{member.online ? "online" : "offline"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
