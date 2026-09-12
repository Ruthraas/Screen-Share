import { useRef, useState } from "react";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { IconChevronRight } from "../components/ui/Icons";
import { Input, TextArea } from "../components/ui/Input";
import { useAccount } from "../components/layout/AccountProvider";
export function Profile() {
 const { user, bio: savedBio, saveProfile } = useAccount();
 const [name,setName]=useState(user.name); const [bio,setBio]=useState(savedBio); const [photo,setPhoto]=useState(user.photoURL);
 const [status,setStatus]=useState(""); const [busy,setBusy]=useState(false); const file=useRef<HTMLInputElement>(null);
 return <div className="settings-stage"><form className="form-card profile-card" onSubmit={async event => { event.preventDefault(); setBusy(true); setStatus(""); try { await saveProfile(name,bio,photo); setStatus("perfil salvo"); } catch { setStatus("nao foi possivel salvar. confira sua conexao e o armazenamento local"); } finally { setBusy(false); } }}>
 <h2>seu perfil</h2><div className="profile-photo-row"><Avatar user={{...user,photoURL:photo}} size="lg" /><div><Button type="button" variant="outline" onClick={() => file.current?.click()}>trocar foto</Button><p>png ou jpg, max 2mb</p></div></div>
 <input className="sr-only" ref={file} type="file" accept="image/png,image/jpeg" aria-label="foto do perfil" onChange={event => { const image=event.target.files?.[0]; if(!image)return; if(!['image/png','image/jpeg'].includes(image.type)||image.size>2*1024*1024){setStatus('selecione um png ou jpg de ate 2mb');return;} const reader=new FileReader();reader.onload=()=>setPhoto(String(reader.result));reader.onerror=()=>setStatus('nao foi possivel ler a foto');reader.readAsDataURL(image); }} />
 <Input label="nome" required maxLength={80} value={name} onChange={event=>setName(event.target.value)} /><TextArea label="bio" maxLength={500} value={bio} onChange={event=>setBio(event.target.value)} />
 <Button type="submit" wide disabled={busy} icon={<IconChevronRight />}>{busy?'salvando':'salvar'}</Button>{status?<p className="auth-status" role="status">{status}</p>:null}
 </form></div>;
}
