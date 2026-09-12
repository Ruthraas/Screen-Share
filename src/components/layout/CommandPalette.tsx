import { useEffect, useMemo, useRef, useState } from "react";
import { IconPlus, IconSearch, IconSettings, IconShare, IconUsers } from "../ui/Icons";

const ALL_ITEMS = [
  { id: "share", label: "compartilhar tela", key: "enter", Icon: IconShare },
  { id: "multi", label: "entrar em grupo", key: "g", Icon: IconUsers },
  { id: "create", label: "criar grupo", key: "n", Icon: IconPlus },
  { id: "settings", label: "configuracoes", key: ",", Icon: IconSettings },
];

export function CommandPalette({ onClose, onAction }: { onClose: () => void; onAction: (action: string) => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? ALL_ITEMS.filter(item => item.label.includes(normalized)) : ALL_ITEMS;
  }, [query]);

  // issue #17: o item selecionado acompanha o filtro — nunca aponta pra
  // fora da lista visível (índice inválido depois de digitar, ou lista
  // vazia sem nenhum resultado).
  useEffect(() => {
    setSelected(current => (items.length === 0 ? 0 : Math.min(current, items.length - 1)));
  }, [items]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    input.current?.focus();
    return () => previous?.focus();
  }, []);

  function move(delta: number) {
    if (items.length === 0) return;
    setSelected(current => (current + delta + items.length) % items.length);
  }

  return <div className="modal-backdrop" onClick={onClose}>
    <section ref={panel} className="palette-command" role="dialog" aria-modal="true" aria-label="comandos" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { e.preventDefault(); if (items[selected]) onAction(items[selected].id); }
      else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    }}>
      <div className="command-search">
        <IconSearch />
        <input
          ref={input}
          className="command-search-input"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="o que voce quer fazer?"
          aria-label="buscar comando"
          autoComplete="off"
        />
      </div>
      {items.length === 0 ? (
        <p className="command-empty muted">nenhum comando encontrado</p>
      ) : (
        items.map(({ id, label, key, Icon }, index) => (
          <button
            tabIndex={-1}
            key={id}
            className={`command-row ${index === selected ? "is-active" : ""}`}
            onPointerMove={event => { if (event.movementX || event.movementY) setSelected(index); }}
            onClick={() => onAction(id)}
          >
            <Icon />
            <span>{label}</span>
            <kbd>{key}</kbd>
          </button>
        ))
      )}
      <footer><span>navegar: up/down</span><span>abrir: enter</span></footer>
    </section>
  </div>;
}
