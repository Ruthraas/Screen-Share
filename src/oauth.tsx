import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GoogleAuthProvider, GithubAuthProvider, signInWithPopup, setPersistence, inMemoryPersistence, signOut } from "firebase/auth";
import { auth, authErrorMessage } from "./services/firebase";
import { Button } from "./components/ui/Button";
import { BrandMark } from "./components/ui/Icons";
import "./styles.css";

const params = new URLSearchParams(location.hash.slice(1));
const state = params.get("state");
const provider = params.get("provider");
history.replaceState(null, "", location.pathname);

function BrowserLogin() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  async function finish(payload: object) {
    const response = await fetch("/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, ...payload }) });
    if (!response.ok) throw new Error("callback-failed");
  }
  async function login() {
    if (!auth || !state || !["google", "github"].includes(provider ?? "")) { setMessage("abra esta pagina pelo aplicativo screenshare"); return; }
    setBusy(true); setMessage("");
    try {
      await setPersistence(auth, inMemoryPersistence);
      const selected = provider === "google" ? new GoogleAuthProvider() : new GithubAuthProvider();
      if (selected instanceof GithubAuthProvider) { selected.addScope("read:user"); selected.addScope("user:email"); }
      const result = await signInWithPopup(auth, selected);
      const credential = provider === "google" ? GoogleAuthProvider.credentialFromResult(result) : GithubAuthProvider.credentialFromResult(result);
      if (!credential) throw new Error("missing-credential");
      await finish({ idToken: credential.idToken, accessToken: credential.accessToken });
      setDone(true); setMessage("login concluido. volte ao screenshare; esta aba pode ser fechada");
    } catch (error) { setMessage(authErrorMessage(error)); }
    finally { if (auth) await signOut(auth).catch(() => {}); setBusy(false); }
  }
  return <main className="settings-stage oauth-browser"><section className="form-card"><BrandMark /><h1>entrar no screenshare</h1><p>continue com {provider === "github" ? "github" : "google"} para entrar no aplicativo</p>{!done ? <Button onClick={login} disabled={busy}>{busy ? "aguarde" : "> continuar"}</Button> : null}<p role="status" className="auth-status">{message}</p></section></main>;
}
createRoot(document.getElementById("root")!).render(<BrowserLogin />);
