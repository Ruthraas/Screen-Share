import type { User } from "../../data/types";
import { Avatar } from "../ui/Avatar";
import { IconShare } from "../ui/Icons";

export function MemberTile({ member, selected, onSelect }: { member: User; selected?: boolean; onSelect: () => void }) {
  return (
    <button className={`member-tile ${selected ? "is-selected" : ""} ${member.sharing ? "is-sharing" : ""}`} type="button" onClick={onSelect}>
      {member.sharing ? <span className="live-dot" /> : null}
      <div className="member-tile__center">
        {member.sharing ? <IconShare /> : <Avatar user={member} />}
        <strong>{member.name}</strong>
      </div>
    </button>
  );
}
