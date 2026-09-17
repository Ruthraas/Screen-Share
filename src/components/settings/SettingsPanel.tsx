import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { IconLogout } from "../ui/Icons";
import { Toggle } from "../ui/Toggle";
import { useAccount } from "../layout/AccountProvider";

/** Versao do app rodando de verdade agora (nao a do release mais recente
 * publicado) — pedido real de suporte: sem isso, nao tinha como um usuario
 * confirmar se uma atualizacao "instalada" realmente substituiu o processo
 * em execucao (ex.: instalador rodou com o app antigo ainda aberto em
 * segundo plano). Silencioso fora do Tauri (dev em navegador puro). */
function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(value => { if (!cancelled) setVersion(value); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return version;
}

export function SettingsPanel({ onEditProfile }: { onEditProfile: () => void }) {
 const { user, preferences, setPreferences, logout } = useAccount(); const [error,setError]=useState("");
 const appVersion = useAppVersion();
 function save(next: typeof preferences) { try { setPreferences(next); setError(""); } catch { setError("nao foi possivel salvar suas preferencias"); } }
 return <section className="form-card settings-card"><h2>configuracoes</h2><span className="section-label">aparencia</span><div className="theme-options">
 <button className={'theme-option ' + (preferences.theme === 'dark' ? 'is-selected' : '')} onClick={() => save({...preferences,theme:'dark'})}><span className="theme-swatch theme-swatch--dark" />escuro</button>
 <button className={'theme-option ' + (preferences.theme === 'light' ? 'is-selected' : '')} onClick={() => save({...preferences,theme:'light'})}><span className="theme-swatch theme-swatch--light" />claro</button></div>
 <span className="section-label">conta</span><div className="setting-row"><span>{user.email ?? user.name}</span><button onClick={onEditProfile}>[editar]</button></div>
 <div className="setting-row setting-row--border"><span>notificacoes</span><Toggle checked={preferences.notifications} onChange={() => save({...preferences,notifications:!preferences.notifications})} label="notificacoes" /></div>
 <span className="section-label">sobre</span><div className="setting-row setting-row--border"><span>versao</span><span className="muted">{appVersion ? `v${appVersion}` : "..."}</span></div>
 <Button variant="danger" icon={<IconLogout />} onClick={() => { void logout().catch(() => setError("nao foi possivel sair. tente novamente")); }}>sair da conta</Button>
 {error ? <p className="auth-status" role="alert">{error}</p> : null}</section>;
}
