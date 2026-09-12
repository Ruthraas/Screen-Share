import { useState } from "react";
import { MemberTile } from "../components/groups/MemberTile";
import { useAccount } from "../components/layout/AccountProvider";
export function MultiScreen() {
 const [memberId, setMemberId] = useState<string | null>(null);
 const { selected } = useAccount();
 if (!selected) return null;
 return <section className="multi-panel"><header><p>{selected.name} ? {selected.activeStreams} transmissoes ativas</p></header>
 <div className="multi-grid">{selected.members.map(member => <MemberTile key={member.id} member={member} selected={memberId === member.id} onSelect={() => setMemberId(member.id)} />)}</div>
 <p className="muted">grupo local. conexoes entre participantes ainda nao estao habilitadas</p></section>;
}
