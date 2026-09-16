import { Component, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { BrandMark, IconChevronRight } from "../ui/Icons";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Issue #13: impede que uma exceção de renderização deixe a janela do
 * aplicativo vazia. Sem telemetria remota — o erro só vai pro console em
 * dev; a UI nunca mostra stack trace, só uma ação de recarregar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] falha de renderização", error, info.componentStack);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="login-stage">
        <section className="empty-state">
          <BrandMark />
          <h1>algo deu errado</h1>
          <p>o aplicativo encontrou um erro inesperado. recarregar deve resolver.</p>
          <Button icon={<IconChevronRight />} onClick={() => location.reload()}>recarregar</Button>
        </section>
      </div>
    );
  }
}
