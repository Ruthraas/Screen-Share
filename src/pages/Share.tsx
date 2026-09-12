import { useAccount } from "../components/layout/AccountProvider";
import { Button } from "../components/ui/Button";
import { IconShare } from "../components/ui/Icons";
import type { Route } from "../data/types";
export function Share({ navigate: _navigate }: { navigate: (route: Route) => void }) {
 const { selected } = useAccount();
 return <section className="share-page"><div className="share-card"><div className="share-hero"><div className="share-box"><IconShare /><strong>compartilhar_tela</strong><span>{selected?.members.filter(member => member.online).length ?? 0} online</span><Button disabled title="compartilhamento disponivel na etapa de conexoes">&gt; iniciar</Button><small className="muted">conexoes ainda nao habilitadas</small></div></div></div></section>;
}
