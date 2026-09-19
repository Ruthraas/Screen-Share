// Harness de teste (mesmo padrão de screen-viewer.tsx, issue #26) — nunca
// faz parte do bundle de produção. Monta o ChatPanel de verdade com
// mensagens fixas, pra validar visualmente sem precisar do app inteiro
// (AccountProvider/RtcProvider/backend).
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatPanel } from "../src/components/rtc/ChatPanel";
import type { ChatMessage } from "../src/components/rtc/chatProtocol";
import type { User } from "../src/data/types";
import "../src/styles.css";

const members: User[] = [
  { id: "u1", name: "harness user", initials: "HU", online: true },
  { id: "u2", name: "jalambir pinto", initials: "JP", online: true },
];

const initialMessages: ChatMessage[] = [
  { from: "u2", text: "ola", at: Date.now() - 60_000 },
  { from: "u1", text: "e ai", at: Date.now() - 30_000 },
  { from: "u2", text: "mensagem um pouco mais longa pra ver se quebra linha direito no painel", at: Date.now() - 5_000 },
];

function Harness() {
  const [messages, setMessages] = useState(initialMessages);
  return (
    <div style={{ width: 320, height: 500, padding: 16, background: "var(--bg)" }}>
      <ChatPanel
        messages={messages}
        selfId="u1"
        members={members}
        onSend={text => setMessages(current => [...current, { from: "u1", text, at: Date.now() }])}
        onClose={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
