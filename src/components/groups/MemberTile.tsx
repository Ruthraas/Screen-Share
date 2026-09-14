import type { User } from "../../data/types";
import { Avatar } from "../ui/Avatar";
import { IconShare } from "../ui/Icons";
import { ConnectionQualityIcon } from "../rtc/ConnectionQualityIcon";
import type { ConnectionQuality } from "../rtc/rtcPolicy";

export function MemberTile({ member, selected, quality, onSelect }: { member: User; selected?: boolean; quality?: ConnectionQuality; onSelect: () => void }) {
  return (
    <button className={`member-tile ${selected ? "is-selected" : ""} ${member.sharing ? "is-sharing" : ""}`} type="button" onClick={onSelect}>
      {member.sharing ? <span className="live-dot" /> : null}
      <div className="member-tile__center">
        {member.sharing ? <IconShare /> : <Avatar user={member} />}
        <strong>{member.name}</strong>
      </div>
      {quality ? <ConnectionQualityIcon quality={quality} /> : null}
    </button>
  );
}
