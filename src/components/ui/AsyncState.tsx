import type { ReactNode } from "react";
import { Button } from "./Button";

/**
 * Estados padronizados pra qualquer área assíncrona do cliente (issue #14:
 * grupos, membros, convites, transmissões). O estado "success" não tem
 * componente próprio — é só o conteúdo normal (lista, card, etc.) sendo
 * renderizado; estes três cobrem loading/empty/error, todos sobre o mesmo
 * container `.empty-state` (já existente, `flex:1; place-items:center`)
 * pra não ter salto de layout ao trocar de estado.
 */
export function LoadingState({ label = "carregando" }: { label?: string }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <p className="muted">
        {label}
        <span className="cursor cursor--blink" aria-hidden="true" />
      </p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <p>{message}</p>
      {onRetry ? <Button variant="outline" type="button" onClick={onRetry}>tentar novamente</Button> : null}
    </div>
  );
}

export function EmptyPanel({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <section className="empty-state">
      {icon}
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {action}
      {secondaryAction}
    </section>
  );
}
