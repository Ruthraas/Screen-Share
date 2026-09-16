import { useAccount } from "../components/layout/AccountProvider";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { EmptyPanel } from "../components/ui/AsyncState";
import { IconSettings, IconUser } from "../components/ui/Icons";
import type { Route } from "../data/types";

/**
 * Home neutra (pedido do usuário): antes esta rota renderizava `Share`
 * amarrado ao grupo selecionado por acaso, então nunca era realmente "a
 * página inicial" — mostrava conteúdo de compartilhamento de tela. Agora é
 * só um resumo da própria conta + atalhos; compartilhar/ver telas dos
 * outros membros vive dentro da sala de cada grupo (`MultiScreen.tsx`,
 * rota "room"), igual Discord.
 */
export function Home({ navigate }: { navigate: (route: Route) => void }) {
  const { user, groups, selectGroup } = useAccount();

  function openRoom(groupId: string) {
    selectGroup(groupId);
    navigate("room");
  }

  return (
    <section className="groups-page">
      <div className="form-card profile-card">
        <div className="profile-photo-row">
          <Avatar user={user} size="lg" />
          <div>
            <strong>{user.name}</strong>
            <p className="muted">{user.email}</p>
          </div>
        </div>
        <div className="panel-heading__actions">
          <Button variant="outline" icon={<IconUser />} onClick={() => navigate("profile")}>editar perfil</Button>
          <Button variant="outline" icon={<IconSettings />} onClick={() => navigate("settings")}>configuracoes</Button>
        </div>
      </div>

      <header className="panel-heading">
        <h1>seus grupos</h1>
      </header>
      {groups.length ? (
        <div className="group-list">
          {groups.map(group => (
            <button key={group.id} className="group-item" type="button" onClick={() => openRoom(group.id)}>
              <div className="group-item__title">
                <span>grupo</span>
                <strong>{group.name}</strong>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyPanel title="voce ainda nao tem nenhum grupo" />
      )}
    </section>
  );
}
