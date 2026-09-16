import { useState } from "react";
import { Button } from "../ui/Button";
import { IconChevronRight } from "../ui/Icons";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { useAccount } from "../layout/AccountProvider";

export function CreateGroupModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { createGroup } = useAccount();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await createGroup(name);
      setName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "nao foi possivel criar o grupo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form className="form-card form-card--modal" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <h2>novo grupo</h2>
        <p>organize seus grupos privados</p>
        <Input label="nome" value={name} required maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} />
        <Input label="convidar por link" value="" placeholder="disponivel depois de criar o grupo" readOnly disabled />
        <Input label="ou convide por e-mail" type="email" disabled placeholder="disponivel na etapa de conexoes" />
        <Button wide type="submit" icon={<IconChevronRight />} disabled={busy}>{busy ? "criando" : "criar grupo"}</Button>
        {error ? <p role="alert" className="auth-status">{error}</p> : null}
      </form>
    </Modal>
  );
}
