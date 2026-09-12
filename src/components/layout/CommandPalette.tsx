import { useEffect, useRef, useState } from "react";
import { IconPlus, IconSearch, IconSettings, IconShare, IconUsers } from "../ui/Icons";

export function CommandPalette({ onClose, onAction }: { onClose: () => void; onAction: (action: string) => void }) {
  const [selected, setSelected] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const items = [
    { id: "share", label: "compartilhar tela", key: "enter", Icon: IconShare },
    { id: "multi", label: "entrar em grupo", key: "g", Icon: IconUsers },
    { id: "create", label: "criar grupo", key: "n", Icon: IconPlus },
    { id: "settings", label: "configuracoes", key: ",", Icon: IconSettings },
  ];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="modal-backdrop" onClick={onClose}>
    <section ref={panel} className="palette-command" role="dialog" aria-modal="true" aria-label="comandos" tabIndex={-1} onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSelected((selected + (e.key === "ArrowDown" ? 1 : 3)) % 4); }
      if (e.key === "Enter") { e.preventDefault(); onAction(items[selected].id); }
      if (e.key === "Tab") { e.preventDefault(); setSelected((selected + (e.shiftKey ? 3 : 1)) % 4); }
    }}>
      <div className="command-search"><IconSearch /><span>o que voce quer fazer?</span><span className="cursor cursor--blink" /></div>
      {items.map(({ id, label, key, Icon }, index) => <button tabIndex={-1} key={id} className={`command-row ${index === selected ? "is-active" : ""}`} onPointerMove={event => { if (event.movementX || event.movementY) setSelected(index); }} onClick={() => onAction(id)}><Icon /><span>{label}</span><kbd>{key}</kbd></button>)}
      <footer><span>navegar: up/down</span><span>abrir: enter</span></footer>
    </section>
  </div>;
}
