import { Button } from "../components/ui/Button";
import { BrandMark, IconChevronRight } from "../components/ui/Icons";

export function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <section className="empty-state">
      <BrandMark />
      <h1>nenhum grupo ainda</h1>
      <p>crie um grupo ou entre com um convite pra comecar a compartilhar tela</p>
      <Button icon={<IconChevronRight />} onClick={onCreate}>criar meu primeiro grupo</Button>
      <button className="link-button" onClick={onJoin}>ou [entrar com convite]</button>
    </section>
  );
}
