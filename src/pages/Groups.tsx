import { useAccount } from "../components/layout/AccountProvider";
import { EmptyPanel } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { MultiScreen } from "./MultiScreen";
import type { Group } from "../data/types";

function GroupItem({ group, onClick, isSelected }: { group: Group; onClick: () => void; isSelected: boolean }) {
  return (
    <button className={`group-item ${isSelected ? "is-selected" : ""}`} type="button" onClick={onClick}>
      <div className="group-item__title">
        <span>grupo</span>
        <strong>{group.name}</strong>
      </div>
      <div className="group-item__meta">
        <span>{group.members.filter(m => m.online).length} online</span>
        <span>{group.activeStreams} transmissões</span>
      </div>
    </button>
  );
}

export function Groups({ onCreate }: { onCreate: () => void }) {
  const { groups, selected, selectGroup } = useAccount();
  return (
    <section className="groups-page">
      <header className="panel-heading"><h1>grupos</h1><Button onClick={onCreate}>{'>'} criar grupo</Button></header>
      {groups.length ? (
        <div className="group-list">
          {groups.map(group => <GroupItem key={group.id} group={group} onClick={() => selectGroup(group.id)} isSelected={selected?.id === group.id} />)}
        </div>
      ) : (
        <EmptyPanel title="nenhum grupo criado neste dispositivo" />
      )}
      {selected ? <MultiScreen /> : null}
    </section>
  );
}
