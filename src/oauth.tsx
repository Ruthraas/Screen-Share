import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrandMark } from "./components/ui/Icons";
import "./styles.css";

const params = new URLSearchParams(location.search);
const state = params.get("state");
const handoffCode = params.get("handoff_code");
const error = params.get("error");
history.replaceState(null, "", location.pathname);

/**
 * Página de retorno do fluxo OAuth no navegador (fallback de desenvolvimento
 * fora do Tauri — issue #1/#30). O backend já concluiu a troca com o
 * provedor e redirecionou para cá só com `state`, `handoff_code` (ou
 * `error`) via query params; nunca com o token em si. Esta página apenas
 * repassa esses valores para a janela que abriu o popup via `postMessage` e
 * se fecha — a troca do `handoff_code` pelo token acontece em `authClient`.
 */
function OAuthCallback() {
  const [delivered, setDelivered] = useState(false);

  useEffect(() => {
    if (!window.opener) return;
    window.opener.postMessage({ type: "screenshare-oauth", state, handoffCode, error }, location.origin);
    setDelivered(true);
    const timer = window.setTimeout(() => window.close(), 600);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="settings-stage oauth-browser">
      <section className="form-card">
        <BrandMark />
        <h1>screenshare</h1>
        <p role="status" className="auth-status">
          {delivered
            ? "login concluido. volte ao screenshare; esta aba pode ser fechada"
            : "abra esta pagina pelo aplicativo screenshare"}
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<OAuthCallback />);
