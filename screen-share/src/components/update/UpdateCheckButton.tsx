import { useEffect, useRef } from "react";
import { IconDownload } from "../ui/Icons";
import { useUpdate } from "./UpdateProvider";
import { shouldPlayUpdateFoundSound } from "./updateFormat";

/** Som de "achou atualização" — pedido do usuário: toca só quando acha,
 * silêncio quando não acha (o clique em si nunca faz barulho). Mesmo
 * espírito do chime de "começou a compartilhar" (`useLocalCapture.ts`),
 * mas com notas diferentes — sintetizado na hora, sem asset de áudio. */
function playUpdateFoundSound(): void {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880; // A5 — uma nota so, tipo notificacao, nao confirmacao de acao
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
    setTimeout(() => { context.close().catch(() => {}); }, 500);
  } catch {
    // Web Audio indisponivel — silencioso, nunca deve travar nada.
  }
}

/**
 * Ícone na sidebar (issue #48, pedido do usuário: "mais fácil deixar um
 * símbolo de download... quando clica vira um loadizinho") — checagem
 * manual de atualização, independente do check automático de uma vez por
 * sessão (`useAppUpdate.ts`). Clicar de novo enquanto já está checando ou
 * baixando não faz nada (evita disparar duas checagens/downloads ao
 * mesmo tempo).
 */
export function UpdateCheckButton() {
  const { state, check } = useUpdate();
  const previousStatusRef = useRef(state.status);

  useEffect(() => {
    if (shouldPlayUpdateFoundSound(previousStatusRef.current, state.status)) playUpdateFoundSound();
    previousStatusRef.current = state.status;
  }, [state.status]);

  const checking = state.status === "checking";
  const busy = checking || state.status === "downloading";

  return (
    <button
      className={`nav-button ${state.status === "available" ? "is-active" : ""}`}
      onClick={check}
      disabled={busy}
      title={checking ? "verificando atualizacoes" : "verificar atualizacoes"}
    >
      <IconDownload className={checking ? "nav-button__spin" : ""} />
    </button>
  );
}
