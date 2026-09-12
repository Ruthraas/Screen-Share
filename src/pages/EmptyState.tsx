import { EmptyPanel } from "../components/ui/AsyncState";
import { Button } from "../components/ui/Button";
import { BrandMark, IconChevronRight } from "../components/ui/Icons";

export function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <EmptyPanel
      icon={<BrandMark />}
      title="nenhum grupo ainda"
      description="crie um grupo ou entre com um convite pra comecar a compartilhar tela"
      action={<Button icon={<IconChevronRight />} onClick={onCreate}>criar meu primeiro grupo</Button>}
      secondaryAction={<button className="link-button" onClick={onJoin}>ou [entrar com convite]</button>}
    />
  );
}
