import { useState } from "react";
import { useStreamSelection } from "../components/groups/useStreamSelection";
import { useAccount } from "../components/layout/AccountProvider";
import { ChatPanel } from "../components/rtc/ChatPanel";
import { useRtc } from "../components/rtc/RtcProvider";
import { CaptureSourcePicker } from "../components/sharing/CaptureSourcePicker";
import { ParticipantGrid } from "../components/sharing/ParticipantGrid";
import { ScreenViewer } from "../components/sharing/ScreenViewer";
import { useLocalCapture } from "../components/sharing/useLocalCapture";
import { Button } from "../components/ui/Button";
import { IconChevronLeft, IconMessage, IconPlayerStop, IconShare } from "../components/ui/Icons";
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
 * Layout pedido pelo usuário, igual Discord: o palco da transmissão domina
 * o centro, a sidebar de membros fica à direita (já era o layout que
 * `ScreenViewer` sabia desenhar sozinho — `members`/`onSelect` — só que
 * `MultiScreen` nunca passava isso antes, mantinha um grid separado em
 * cima que empurrava o viewer pra baixo). `useLocalCapture` é o mesmo hook
 * que `Share.tsx` usava (removida), sem nenhuma mudança nele.
 *
 * Botão "compartilhar tela" no cabeçalho (achado real testando: clicar no
 * próprio avatar na sidebar pra iniciar não era nada óbvio, sem nenhum
 * rótulo indicando essa ação) — a sidebar continua servindo pra ver a
 * tela de quem já está transmitindo, iniciar/parar é só pelo botão.
 */
export function MultiScreen({ onBack }: { onBack: () => void }) {
  const { selected, createInviteLink, user } = useAccount();
  const { remoteStreams, sharingPeers, signalingStatus, peerQuality, chatMessages, sendChatMessage } = useRtc();
  const capture = useLocalCapture();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const members = (selected?.members ?? []).map(member => ({
    ...member,
    sharing: member.id === user.id ? capture.status === "active" : sharingPeers.has(member.id),
    // RTT só existe entre peers de verdade — nunca contra si mesmo.
    quality: member.id === user.id ? undefined : peerQuality.get(member.id),
  }));
  const activeIds = members.filter(member => member.sharing).map(member => member.id);
  // Ver a própria transmissão nunca é o mais importante da tela (pedido do
  // usuário): o palco principal nunca pula pra você automaticamente,
  // mesmo enquanto você está compartilhando — só troca pra você com um
  // clique manual no seu próprio avatar, igual qualquer outro membro.
  const [memberId, setMemberId] = useStreamSelection(activeIds, [user.id]);
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
  }

  async function handleStopSharing() {
    setMemberId(null);
    await capture.stop();
  }

  if (!selected) return null;
  const viewingMember = members.find(member => member.id === memberId);
  const viewingSelf = memberId === user.id;
  const viewingStream = viewingSelf ? capture.stream : memberId ? remoteStreams.get(memberId) : undefined;

  // Sala de espera (grid) só faz sentido depois de saber de verdade quem
  // está transmitindo — enquanto a sinalização ainda está conectando,
  // ninguém em `sharingPeers` seria "ninguém compartilhando" por engano.
  const showWaitingRoom = signalingStatus !== "connecting" && activeIds.length === 0;

  return (
    <section className="multi-panel">
      <header>
        <Button variant="ghost" icon={<IconChevronLeft />} onClick={onBack}>todos os grupos</Button>
        <p>{activeIds.length} transmissoes ativas</p>
      </header>
      {inviteStatus ? <p className="muted" role="status">{inviteStatus}</p> : null}
      {capture.error ? <p className="muted" role="alert">{capture.error}</p> : null}
      <div className="multi-content">
        <div className="multi-viewer-area">
          {showWaitingRoom ? (
            <ParticipantGrid members={members} />
          ) : (
            <ScreenViewer
              user={viewingMember}
              stream={viewingStream}
              members={members}
              loading={viewingSelf && !capture.hasFrame}
              emptyMessage={signalingStatus === "connecting" ? "conectando..." : "selecione um participante pra ver a tela"}
              onSelect={member => setMemberId(member.id)}
              onStop={viewingSelf ? () => void handleStopSharing() : () => setMemberId(null)}
              onStreamEnded={viewingSelf ? () => void handleStopSharing() : undefined}
            />
          )}
        </div>
        {chatOpen ? (
          <ChatPanel messages={chatMessages} selfId={user.id} members={members} onSend={sendChatMessage} onClose={() => setChatOpen(false)} />
        ) : null}
      </div>
      {/* Barra de controles flutuante (pedido do usuário, inspirado no
         layout de um app de chamada de um amigo dele) — as ações da sala
         (compartilhar/parar, convidar, chat) saem do cabeçalho e ficam
         sempre visíveis por cima do palco, ScreenViewer ou grid de espera. */}
      <div className="stage-controls">
        {capture.status === "active" ? (
          <Button variant="danger" icon={<IconPlayerStop />} onClick={() => void handleStopSharing()}>parar transmissao</Button>
        ) : (
          <Button icon={<IconShare />} disabled={capture.status === "starting"} onClick={() => setPickerOpen(true)}>
            {capture.status === "starting" ? "iniciando..." : "compartilhar tela"}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void handleCopyInvite()}>copiar convite</Button>
        <button type="button" className={`nav-button ${chatOpen ? "is-active" : ""}`} title="chat da sala" onClick={() => setChatOpen(open => !open)}><IconMessage /></button>
      </div>
      <CaptureSourcePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onStart={(sourceId, quality, audioEnabled, fps) => void handleStartSharing(sourceId, quality, audioEnabled, fps)} />
    </section>
  );
}
