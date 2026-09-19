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
import { ParticipantGrid } from "../src/components/sharing/ParticipantGrid";
import "../src/styles.css";

const user = { id: "u1", name: "harness user", initials: "HU", online: true, current: true };
const members = [
  user,
  { id: "u2", name: "boa conexao", initials: "BC", online: true, sharing: true, quality: "good" as const },
  { id: "u3", name: "conexao ok", initials: "OK", online: true, quality: "ok" as const },
  { id: "u4", name: "conexao ruim", initials: "RU", online: true, quality: "bad" as const },
  { id: "u5", name: "offline", initials: "OF", online: false },
];

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
      <ScreenViewer user={user} stream={stream} members={members} onStop={() => {}} onStreamEnded={() => setEndedCount(c => c + 1)} />
      {/* Mesmo contexto flex de MultiScreen.tsx (`.multi-viewer-area`,
         altura fixa aqui só pra dar pra ver a centralização vertical de
         verdade no harness) — `.participant-grid-stage` usa `margin: auto`
         pra se centralizar sozinho dentro dele. */}
      <div data-testid="participant-grid-preview" className="multi-viewer-area" style={{ marginTop: 24, height: 500 }}>
        <ParticipantGrid members={members} />
      </div>
      <div data-testid="participant-grid-preview-2-membros" className="multi-viewer-area" style={{ marginTop: 24, height: 500 }}>
        <ParticipantGrid members={members.slice(0, 2)} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
