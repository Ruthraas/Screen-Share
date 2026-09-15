import { useState } from "react";
import { MemberTile } from "../components/groups/MemberTile";
import { useStreamSelection } from "../components/groups/useStreamSelection";
import { useAccount } from "../components/layout/AccountProvider";
import { useRtc } from "../components/rtc/RtcProvider";
import { Avatar } from "../components/ui/Avatar";
import { CaptureSourcePicker } from "../components/sharing/CaptureSourcePicker";
import { ScreenViewer } from "../components/sharing/ScreenViewer";
import { useLocalCapture } from "../components/sharing/useLocalCapture";
import { Button } from "../components/ui/Button";
import { IconChevronLeft, IconShare } from "../components/ui/Icons";
import type { CaptureFps, CaptureQuality } from "../services/captureClient";

/**
 * Sala de UM grupo especifico (rota "room", separada da lista de grupos —
 * antes as duas ficavam empilhadas na mesma pagina, confuso: parecia que
 * clicar num grupo so "revelava mais coisa embaixo" em vez de entrar em
 * outro lugar). O nome do grupo ja aparece na topbar do `AppShell`
 * (`title`), entao o cabecalho aqui nao repete — so o essencial da sala:
 * voltar, contagem de transmissoes, convite.
 *
 * `sharingPeers`/`remoteStreams` vêm de verdade da malha de
 * `RTCPeerConnection` (`useGroupConnections.ts`), não do campo estático
 * `member.sharing` (nunca era definido antes da issue #71 — sempre
 * `undefined`).
 *
 * Compartilhar a própria tela agora acontece aqui dentro, igual Discord:
 * seu próprio tile no mesmo grid dos outros membros (antes vivia separado
 * em `Share.tsx`, amarrado por acaso ao grupo selecionado — por isso a
 * antiga rota "home" nunca era realmente neutra). `useLocalCapture` é o
 * mesmo hook que `Share.tsx` usava, sem nenhuma mudança nele.
 */
export function MultiScreen({ onBack }: { onBack: () => void }) {
  const { selected, createInviteLink, user } = useAccount();
  const { remoteStreams, sharingPeers, peerQuality, signalingStatus } = useRtc();
  const capture = useLocalCapture();
  const [pickerOpen, setPickerOpen] = useState(false);
  const members = (selected?.members ?? []).map(member => ({
    ...member,
    sharing: member.id === user.id ? capture.status === "active" : sharingPeers.has(member.id),
  }));
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

  async function handleStartSharing(sourceId: string, quality: CaptureQuality, audioEnabled: boolean, fps: CaptureFps) {
    setPickerOpen(false);
    await capture.start(sourceId, quality, audioEnabled, fps);
    setMemberId(user.id);
  }

  async function handleStopSharing() {
    setMemberId(null);
    await capture.stop();
  }

  function handleSelectTile(memberIdClicked: string) {
    if (memberIdClicked === user.id && capture.status !== "active") {
      setPickerOpen(true);
      return;
    }
    setMemberId(memberIdClicked);
  }

  if (!selected) return null;
  const viewingMember = members.find(member => member.id === memberId);
  const viewingSelf = memberId === user.id;
  const viewingStream = viewingSelf ? capture.stream : memberId ? remoteStreams.get(memberId) : undefined;

  return (
    <section className="multi-panel">
      <header>
        <Button variant="ghost" icon={<IconChevronLeft />} onClick={onBack}>todos os grupos</Button>
        <p>{activeIds.length} transmissoes ativas</p>
        <Button variant="ghost" onClick={() => void handleCopyInvite()}>copiar convite</Button>
      </header>
      <div className="multi-grid">
        {members.map(member =>
          member.id === user.id ? (
            <button
              key={member.id}
              className={`member-tile ${memberId === member.id ? "is-selected" : ""} ${capture.status === "active" ? "is-sharing" : ""}`}
              type="button"
              onClick={() => handleSelectTile(member.id)}
            >
              {capture.status === "active" ? <span className="live-dot" /> : null}
              <div className="member-tile__center">
                {capture.status === "active" ? <IconShare /> : <Avatar user={user} />}
                <strong>{capture.status === "starting" ? "iniciando..." : "voce"}</strong>
              </div>
            </button>
          ) : (
            <MemberTile
              key={member.id}
              member={member}
              selected={memberId === member.id}
              quality={peerQuality.get(member.id)}
              onSelect={() => handleSelectTile(member.id)}
            />
          ),
        )}
      </div>
      {inviteStatus ? <p className="muted" role="status">{inviteStatus}</p> : null}
      {capture.error ? <p className="muted" role="alert">{capture.error}</p> : null}
      <div className="multi-viewer-area">
        {viewingMember && viewingStream ? (
          <ScreenViewer
            user={viewingMember}
            stream={viewingStream}
            loading={viewingSelf && !capture.hasFrame}
            onStop={viewingSelf ? () => void handleStopSharing() : () => setMemberId(null)}
            onStreamEnded={viewingSelf ? () => void handleStopSharing() : undefined}
          />
        ) : (
          <p className="muted">
            {signalingStatus === "connecting" ? "conectando..." : activeIds.length === 0 ? "ninguem esta compartilhando a tela agora" : "selecione um participante pra ver a tela"}
          </p>
        )}
      </div>
      <CaptureSourcePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onStart={(sourceId, quality, audioEnabled, fps) => void handleStartSharing(sourceId, quality, audioEnabled, fps)} />
    </section>
  );
}
