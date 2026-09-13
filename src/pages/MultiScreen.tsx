import { useState } from "react";
import { MemberTile } from "../components/groups/MemberTile";
import { useStreamSelection } from "../components/groups/useStreamSelection";
import { useAccount } from "../components/layout/AccountProvider";
import { Button } from "../components/ui/Button";

export function MultiScreen() {
  const { selected, createInviteLink } = useAccount();
  const activeIds = (selected?.members ?? []).filter(member => member.sharing).map(member => member.id);
  const [memberId, setMemberId] = useStreamSelection(activeIds);
  const [inviteStatus, setInviteStatus] = useState("");

  async function handleCopyInvite() {
    setInviteStatus("gerando convite...");
    try {
      const token = await createInviteLink();
      await navigator.clipboard.writeText(token);
      setInviteStatus("convite copiado");
    } catch (err) {
      setInviteStatus(err instanceof Error ? err.message : "nao foi possivel gerar o convite");
    }
  }

  if (!selected) return null;
  return (
    <section className="multi-panel">
      <header>
        <p>{selected.name} · {selected.activeStreams} transmissoes ativas</p>
        <Button variant="ghost" onClick={() => void handleCopyInvite()}>copiar convite</Button>
      </header>
      <div className="multi-grid">
        {selected.members.map(member => (
          <MemberTile key={member.id} member={member} selected={memberId === member.id} onSelect={() => setMemberId(member.id)} />
        ))}
      </div>
      {inviteStatus ? <p className="muted" role="status">{inviteStatus}</p> : null}
      <p className="muted">grupo local. conexoes entre participantes ainda nao estao habilitadas</p>
    </section>
  );
}
