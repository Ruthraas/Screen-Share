import { useState } from "react";
import { Button } from "../ui/Button";
import { IconChevronRight } from "../ui/Icons";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { useAccount } from "../layout/AccountProvider";
export function CreateGroupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
 const { createGroup } = useAccount();
 const [name, setName] = useState(""); const [error, setError] = useState("");
 return <Modal open={open} onClose={onClose}><form className="form-card form-card--modal" onSubmit={event => { event.preventDefault(); try { createGroup(name); setName(""); setError(""); onCreated(); } catch { setError("nao foi possivel salvar o grupo neste dispositivo"); } }}>
 <h2>novo grupo</h2><p>organize seus grupos neste dispositivo</p><Input label="nome" value={name} required maxLength={80} onChange={event => setName(event.target.value)} />
 <Input label="convidar por link" value="" placeholder="convites remotos ainda indisponiveis" readOnly disabled />
 <Input label="ou convide por e-mail" type="email" disabled placeholder="disponivel na etapa de conexoes" />
 <Button wide type="submit" icon={<IconChevronRight />}>criar grupo</Button>{error ? <p role="alert" className="auth-status">{error}</p> : null}
 </form></Modal>;
}
