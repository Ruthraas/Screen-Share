import type { User } from "../../data/types";

export function Avatar({ user, size = "md" }: { user: Pick<User, "initials" | "current" | "photoURL">; size?: "sm" | "md" | "lg" }) {
  return <span className={`avatar avatar--${size} ${user.current ? "is-online" : ""}`}>{user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : user.initials}</span>;
}
