import { useState } from "react";
import { useAccount } from "../components/layout/AccountProvider";
import { EmptyPanel } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { MultiScreen } from "./MultiScreen";
import type { Group } from "../data/types";

function GroupItem({ group, onClick, isSelected, onLeave, onDelete, busy }: { group: Group; onClick: () => void; isSelected: boolean; onLeave: () => void; onDelete: () => void; busy: boolean }) {
  return (
    <div className={`group-item ${isSelected ? "is-selected" : ""}`}>
      <button className="group-item__body" type="button" onClick={onClick}>
        <div className="group-item__title">
          <span>grupo</span>
          <strong>{group.name}</strong>
        </div>
        <div className="group-item__meta">
          <span>{group.members.filter(m => m.online).length} online</span>
          <span>{group.activeStreams} transmissões</span>
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

export function Groups({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const { groups, selected, selectGroup, leaveGroup, deleteGroup } = useAccount();
  const [busyId, setBusyId] = useState<string | null>(null);

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
              onClick={() => selectGroup(group.id)}
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
      {selected ? <MultiScreen /> : null}
    </section>
  );
}
