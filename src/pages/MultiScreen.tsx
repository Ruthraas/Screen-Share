import { MemberTile } from "../components/groups/MemberTile";
import { useStreamSelection } from "../components/groups/useStreamSelection";
import { useAccount } from "../components/layout/AccountProvider";

export function MultiScreen() {
  const { selected } = useAccount();
  const activeIds = (selected?.members ?? []).filter(member => member.sharing).map(member => member.id);
  const [memberId, setMemberId] = useStreamSelection(activeIds);
  if (!selected) return null;
  return (
    <section className="multi-panel">
      <header><p>{selected.name} ? {selected.activeStreams} transmissoes ativas</p></header>
      <div className="multi-grid">
        {selected.members.map(member => (
          <MemberTile key={member.id} member={member} selected={memberId === member.id} onSelect={() => setMemberId(member.id)} />
        ))}
      </div>
      <p className="muted">grupo local. conexoes entre participantes ainda nao estao habilitadas</p>
    </section>
  );
}
