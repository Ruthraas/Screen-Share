import { useEffect, useState } from "react";
import { useAccount } from "../components/layout/AccountProvider";
import { getPresence } from "../services/groupsApi";
import { EmptyPanel } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import type { Group } from "../data/types";

/** Contagem real de online por card (issue backend #36, presença nunca
 * consumida pelo cliente antes) — busca a própria, sem heartbeat (só quem
 * já está na sala manda heartbeat, `AccountProvider.tsx`; um card na lista
 * não significa "estou nesse grupo agora"). Nunca mostra "0 online" como
 * se fosse dado real enquanto ainda não sabe — fica em branco até
 * carregar, igual as miniaturas de captura fazem. */
function useOnlineCount(groupId: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCount(null);
    getPresence(groupId).then(
      entries => { if (!cancelled) setCount(entries.filter(entry => entry.online).length); },
      () => { if (!cancelled) setCount(null); },
    );
    return () => { cancelled = true; };
  }, [groupId]);
  return count;
}

function GroupItem({ group, onClick, isSelected, onLeave, onDelete, busy }: { group: Group; onClick: () => void; isSelected: boolean; onLeave: () => void; onDelete: () => void; busy: boolean }) {
  const onlineCount = useOnlineCount(group.id);
  return (
    <div className={`group-item ${isSelected ? "is-selected" : ""}`}>
      <button className="group-item__body" type="button" onClick={onClick}>
        <div className="group-item__title">
          <span>grupo</span>
          <strong>{group.name}</strong>
        </div>
        <div className="group-item__meta">
          <span>{onlineCount === null ? "..." : onlineCount} online</span>
        </div>
      </button>
      <div className="group-item__actions">
        {group.role === "owner" ? (
          <Button variant="danger" disabled={busy} onClick={onDelete}>excluir</Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={onLeave}>sair</Button>
        )}
      </div>
    </div>
  );
}

/**
 * Lista de grupos — só isso (issue de layout: antes essa página tinha,
 * empilhada embaixo, a sala inteira do grupo selecionado — confuso, dava a
 * impressão de "clicar num card e a coisa só aparecer mais embaixo" em vez
 * de entrar em outro lugar). Selecionar um grupo agora navega pra rota
 * "room" dedicada (`MultiScreen`, via `onOpenRoom`), como entrar numa sala.
 */
export function Groups({ onCreate, onJoin, onOpenRoom }: { onCreate: () => void; onJoin: () => void; onOpenRoom: () => void }) {
  const { groups, selected, selectGroup, leaveGroup, deleteGroup } = useAccount();
  const [busyId, setBusyId] = useState<string | null>(null);

  function openRoom(group: Group) {
    selectGroup(group.id);
    onOpenRoom();
  }

  async function handleLeave(group: Group) {
    if (!window.confirm(`sair do grupo "${group.name}"?`)) return;
    setBusyId(group.id);
    try {
      await leaveGroup(group.id);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(group: Group) {
    if (!window.confirm(`excluir o grupo "${group.name}"? essa acao nao pode ser desfeita`)) return;
    setBusyId(group.id);
    try {
      await deleteGroup(group.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="groups-page">
      <header className="panel-heading">
        <h1>grupos</h1>
        <div className="panel-heading__actions">
          <Button variant="ghost" onClick={onJoin}>entrar com convite</Button>
          <Button onClick={onCreate}>{'>'} criar grupo</Button>
        </div>
      </header>
      {groups.length ? (
        <div className="group-list">
          {groups.map(group => (
            <GroupItem
              key={group.id}
              group={group}
              onClick={() => openRoom(group)}
              isSelected={selected?.id === group.id}
              busy={busyId === group.id}
              onLeave={() => void handleLeave(group)}
              onDelete={() => void handleDelete(group)}
            />
          ))}
        </div>
      ) : (
        <EmptyPanel title="voce ainda nao tem nenhum grupo" />
      )}
    </section>
  );
}
