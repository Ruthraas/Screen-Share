import type { User } from "../../data/types";

/** `is-online` reflete presença de verdade (`user.online`) — chegou a
 * checar `user.current` ("é você?") por engano, o que fazia o próprio
 * avatar sempre parecer online e todo mundo mais nunca aparecer, mesmo
 * conectado (achado revisando o layout de grupos: a presença real só
 * passou a existir depois de ligar `GET /groups/{id}/presence`, mas o
 * indicador visual já existia de antes, sem dado real pra refletir). */
export function Avatar({ user, size = "md" }: { user: Pick<User, "initials" | "online" | "photoURL">; size?: "sm" | "md" | "lg" }) {
  return <span className={`avatar avatar--${size} ${user.online ? "is-online" : ""}`}>{user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : user.initials}</span>;
}
