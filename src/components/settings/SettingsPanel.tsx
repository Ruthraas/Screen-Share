import { useState } from "react";
import { Button } from "../ui/Button";
import { IconLogout } from "../ui/Icons";
import { Toggle } from "../ui/Toggle";
import { useAccount } from "../layout/AccountProvider";
export function SettingsPanel({ onEditProfile }: { onEditProfile: () => void }) {
 const { user, preferences, setPreferences, logout } = useAccount(); const [error,setError]=useState("");
 function save(next: typeof preferences) { try { setPreferences(next); setError(""); } catch { setError("nao foi possivel salvar suas preferencias"); } }
 return <section className="form-card settings-card"><h2>configuracoes</h2><span className="section-label">aparencia</span><div className="theme-options">
 <button className={'theme-option ' + (preferences.theme === 'dark' ? 'is-selected' : '')} onClick={() => save({...preferences,theme:'dark'})}><span className="theme-swatch theme-swatch--dark" />escuro</button>
 <button className={'theme-option ' + (preferences.theme === 'light' ? 'is-selected' : '')} onClick={() => save({...preferences,theme:'light'})}><span className="theme-swatch theme-swatch--light" />claro</button></div>
 <span className="section-label">conta</span><div className="setting-row"><span>{user.email ?? user.name}</span><button onClick={onEditProfile}>[editar]</button></div>
 <div className="setting-row setting-row--border"><span>notificacoes</span><Toggle checked={preferences.notifications} onChange={() => save({...preferences,notifications:!preferences.notifications})} label="notificacoes" /></div>
 <Button variant="danger" icon={<IconLogout />} onClick={() => { void logout().catch(() => setError("nao foi possivel sair. tente novamente")); }}>sair da conta</Button>
 {error ? <p className="auth-status" role="alert">{error}</p> : null}</section>;
}
