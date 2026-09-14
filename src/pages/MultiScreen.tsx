import { useState } from "react";
import { MemberTile } from "../components/groups/MemberTile";
import { useStreamSelection } from "../components/groups/useStreamSelection";
import { useAccount } from "../components/layout/AccountProvider";
import { useRtc } from "../components/rtc/RtcProvider";
import { ScreenViewer } from "../components/sharing/ScreenViewer";
import { Button } from "../components/ui/Button";

/**
 * Issue #71: `sharingPeers`/`remoteStreams` vêm de verdade da malha de
 * `RTCPeerConnection` (`useGroupConnections.ts`), não mais do campo estático
 * `member.sharing` (nunca era definido antes desta issue — sempre `undefined`).
 */
export function MultiScreen() {
  const { selected, createInviteLink } = useAccount();
  const { remoteStreams, sharingPeers, peerQuality, signalingStatus } = useRtc();
  const members = (selected?.members ?? []).map(member => ({ ...member, sharing: sharingPeers.has(member.id) }));
  const activeIds = members.filter(member => member.sharing).map(member => member.id);
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
  const viewingMember = members.find(member => member.id === memberId);
  const viewingStream = memberId ? remoteStreams.get(memberId) : undefined;

  return (
    <section className="multi-panel">
      <header>
        <p>{selected.name} · {activeIds.length} transmissoes ativas</p>
        <Button variant="ghost" onClick={() => void handleCopyInvite()}>copiar convite</Button>
      </header>
      <div className="multi-grid">
        {members.map(member => (
          <MemberTile
            key={member.id}
            member={member}
            selected={memberId === member.id}
            quality={peerQuality.get(member.id)}
            onSelect={() => setMemberId(member.id)}
          />
        ))}
      </div>
      {inviteStatus ? <p className="muted" role="status">{inviteStatus}</p> : null}
      {viewingMember && viewingStream ? (
        <ScreenViewer user={viewingMember} stream={viewingStream} onStop={() => setMemberId(null)} />
      ) : (
        <p className="muted">
          {signalingStatus === "connecting" ? "conectando..." : activeIds.length === 0 ? "ninguem esta compartilhando a tela agora" : "selecione um participante pra ver a tela"}
        </p>
      )}
    </section>
  );
}
