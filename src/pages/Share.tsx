import { useState } from "react";
import { CaptureSourcePicker } from "../components/sharing/CaptureSourcePicker";
import { ScreenViewer } from "../components/sharing/ScreenViewer";
import { useLocalCapture } from "../components/sharing/useLocalCapture";
import { useAccount } from "../components/layout/AccountProvider";
import { Button } from "../components/ui/Button";
import { IconShare } from "../components/ui/Icons";
import type { CaptureFps, CaptureQuality } from "../services/captureClient";
import type { Route } from "../data/types";

export function Share({ navigate: _navigate }: { navigate: (route: Route) => void }) {
  const { selected, user } = useAccount();
  const { status, error, stream, hasFrame, start, stop } = useLocalCapture();
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleStart(sourceId: string, quality: CaptureQuality, audioEnabled: boolean, fps: CaptureFps) {
    setPickerOpen(false);
    await start(sourceId, quality, audioEnabled, fps);
  }

  if (status === "active" && stream) {
    return (
      <section className="share-page">
        <ScreenViewer user={user} stream={stream} loading={!hasFrame} onStop={() => void stop()} onStreamEnded={() => void stop()} />
      </section>
    );
  }

  return (
    <section className="share-page">
      <div className="share-card">
        <div className="share-hero">
          <div className="share-box">
            <IconShare />
            <strong>compartilhar_tela</strong>
            <span>{selected?.members.filter(member => member.online).length ?? 0} online</span>
            <Button onClick={() => setPickerOpen(true)} disabled={status === "starting"}>
              {status === "starting" ? "iniciando" : "> iniciar"}
            </Button>
            {error ? <small role="alert" className="auth-status">{error}</small> : null}
            <small className="muted">outros participantes do grupo veem sua tela em "grupos" assim que voce iniciar</small>
          </div>
        </div>
      </div>
      <CaptureSourcePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onStart={(sourceId, quality, audioEnabled, fps) => void handleStart(sourceId, quality, audioEnabled, fps)} />
    </section>
  );
}
