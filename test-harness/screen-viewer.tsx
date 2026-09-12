// Harness de teste (issue #26) — nunca faz parte do bundle de produção:
// esta pasta não está listada em vite.config.ts (build.rollupOptions.input),
// só é servida pelo dev server que scripts/check-ui.mjs já sobe sozinho pra
// rodar o smoke test. Monta o ScreenViewer de verdade (não uma versão
// simplificada) com controles expostos em window.__harness, pra testar com
// um MediaStream real (canvas.captureStream()) em vez de mockar o
// componente.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScreenViewer } from "../src/components/sharing/ScreenViewer";
import "../src/styles.css";

const user = { id: "u1", name: "harness user", initials: "HU", online: true, current: true };

function Harness() {
  const [stream, setStream] = useState<MediaStream | undefined>(undefined);
  const [endedCount, setEndedCount] = useState(0);

  (window as any).__harness = {
    setStream: (value: MediaStream | undefined) => setStream(value),
    endedCount: () => endedCount,
  };

  return (
    <div>
      <div data-testid="ended-count">{endedCount}</div>
      <ScreenViewer user={user} stream={stream} onMinimize={() => {}} onStreamEnded={() => setEndedCount(c => c + 1)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
