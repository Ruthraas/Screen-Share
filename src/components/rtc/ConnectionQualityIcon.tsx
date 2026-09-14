import { IconWifi, IconWifi2, IconWifiOff } from "../ui/Icons";
import type { ConnectionQuality } from "./rtcPolicy";

/** Ícone + título acessível pro indicador de ping/qualidade pedido pela
 * issue #71 — `unknown` (conexão nova, sem par ICE selecionado ainda) não
 * mostra nada, pra não piscar "ruim" só porque a conexão acabou de abrir. */
export function ConnectionQualityIcon({ quality }: { quality: ConnectionQuality }) {
  if (quality === "unknown") return null;
  if (quality === "good") return <IconWifi className="quality-icon quality-icon--good" aria-label="conexao boa" />;
  if (quality === "ok") return <IconWifi2 className="quality-icon quality-icon--ok" aria-label="conexao instavel" />;
  return <IconWifiOff className="quality-icon quality-icon--bad" aria-label="conexao ruim" />;
}
