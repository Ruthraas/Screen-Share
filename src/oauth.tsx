import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrandMark } from "./components/ui/Icons";
import { completeOAuthFromFragment } from "./services/authClient";
import "./styles.css";

const hash = location.hash;
history.replaceState(null, "", location.pathname);

/**
 * Página de retorno do fluxo OAuth no navegador (issue #1/#30, fallback de
 * desenvolvimento fora do Tauri — no desktop o retorno é por deep link, não
 * por aqui). O backend faz uma navegação de verdade pra cá — não é popup —
 * com o resultado no fragmento da URL: sucesso vem como
 * `#access_token=...&refresh_token=...&provider=...`, erro como
 * `#error=<código>`. Esta página persiste a sessão (ou guarda o erro) e
 * volta pro app; quem lê o resultado é `useSession` (AccountProvider) no
 * próximo carregamento.
 */
function OAuthCallback() {
  const [status, setStatus] = useState("concluindo o login...");

  useEffect(() => {
    let cancelled = false;
    completeOAuthFromFragment(hash).finally(() => {
      if (cancelled) return;
      setStatus("voltando ao screenshare...");
      location.href = "/";
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="settings-stage oauth-browser">
      <section className="form-card">
        <BrandMark />
        <h1>screenshare</h1>
        <p role="status" className="auth-status">{status}</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OAuthCallback />);
