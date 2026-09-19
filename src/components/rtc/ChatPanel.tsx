import { useEffect, useRef, useState } from "react";
import type { User } from "../../data/types";
import { IconArrowUp, IconX } from "../ui/Icons";
import type { ChatMessage } from "./chatProtocol";
import { MAX_CHAT_MESSAGE_LENGTH } from "./chatProtocol";

function nameFor(uid: string, selfId: string, members: User[]): string {
  if (uid === selfId) return "você";
  return members.find(member => member.id === uid)?.name ?? uid;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Chat efêmero da sala (pedido do usuário) — painel lateral, mesmo espírito
 * do app de referência que inspirou o layout, mas com nossa paleta/tipo
 * mono. Puramente controlado por `useGroupConnections`/`ChatMessage[]`:
 * este componente não sabe nada sobre `RTCDataChannel`, só mostra o que já
 * chegou e chama `onSend` pro texto novo.
 */
export function ChatPanel({ messages, selfId, members, onSend, onClose }: { messages: ChatMessage[]; selfId: string; members: User[]; onSend: (text: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <aside className="chat-panel">
      <header className="chat-panel__header">
        <span>mensagens</span>
        <button type="button" className="nav-button" title="fechar chat" onClick={onClose}><IconX /></button>
      </header>
      <div className="chat-panel__list" ref={listRef}>
        {messages.length === 0 ? <p className="muted chat-panel__empty">nenhuma mensagem ainda</p> : null}
        {messages.map((message, index) => (
          <div key={`${message.from}-${message.at}-${index}`} className={`chat-message ${message.from === selfId ? "is-self" : ""}`}>
            <div className="chat-message__meta">
              <span className="chat-message__author">{nameFor(message.from, selfId, members)}</span>
              <span className="chat-message__time">{formatTime(message.at)}</span>
            </div>
            <p className="chat-message__text">{message.text}</p>
          </div>
        ))}
      </div>
      <form className="chat-panel__composer" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          placeholder="mensagem pra sala"
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          aria-label="mensagem pra sala"
        />
        <button type="submit" className="nav-button" disabled={!draft.trim()} title="enviar"><IconArrowUp /></button>
      </form>
    </aside>
  );
}
