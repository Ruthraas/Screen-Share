import { useState } from "react";
import { Button } from "../ui/Button";
import { IconChevronRight } from "../ui/Icons";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { useAccount } from "../layout/AccountProvider";

export function JoinGroupModal({ open, onClose, onJoined }: { open: boolean; onClose: () => void; onJoined: () => void }) {
  const { acceptInvite } = useAccount();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await acceptInvite(token);
      setToken("");
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "nao foi possivel entrar com esse convite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form className="form-card form-card--modal" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <h2>entrar com convite</h2>
        <p>cole o codigo ou link de convite que voce recebeu</p>
        <Input label="convite" value={token} required disabled={busy} onChange={event => setToken(event.target.value)} placeholder="codigo do convite" />
        <Button wide type="submit" icon={<IconChevronRight />} disabled={busy}>{busy ? "entrando" : "entrar no grupo"}</Button>
        {error ? <p role="alert" className="auth-status">{error}</p> : null}
      </form>
    </Modal>
  );
}
