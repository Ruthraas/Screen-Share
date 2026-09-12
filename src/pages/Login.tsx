import { useState, useEffect } from "react";
import { Button } from "../components/ui/Button";
import { IconChevronRight, IconEye, IconEyeOff } from "../components/ui/Icons";
import {
  AuthError,
  authErrorMessage,
  loginWithEmail,
  loginWithOAuth,
  registerWithEmail,
  type OAuthProvider,
} from "../services/authClient";

export function Login({ sessionError }: { sessionError?: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    setFormVisible(false);
    setTimeout(() => setFormVisible(true), 200);
  }, [mode]);

  useEffect(() => {
    if (sessionError) setStatus(authErrorMessage(new AuthError(sessionError)));
  }, [sessionError]);

  const isSignup = mode === "signup";
  const command = isSignup ? "signup" : "login";

  async function submitEmailAuth() {
    setStatus("");

    if (isSignup && password !== confirmPassword) {
      setStatus("as senhas nao conferem");
      return;
    }

    setLoading(true);

    try {
      if (isSignup) {
        await registerWithEmail(name, email, password);
      } else {
        await loginWithEmail(email, password);
      }

    } catch (error) {
      setStatus(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function submitProvider(provider: OAuthProvider) {
    setStatus("");
    setStatus("continue o login na janela do navegador");
    setLoading(true);

    try {
      await loginWithOAuth(provider);
    } catch (error) {
      setStatus(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-stage">
      <section className={`terminal-window login-window ${isSignup ? "is-signup" : ""}`}>
        <header className="terminal-titlebar">
          <span />
          <span />
          <span />
          <p>screenshare - {isSignup ? "cadastro" : "login"}</p>
        </header>
        <form className="terminal-body" onSubmit={event => { event.preventDefault(); void submitEmailAuth(); }}>
          <div className="terminal-header" style={{ opacity: formVisible ? 1 : 0, transform: formVisible ? 'translateY(0)' : 'translateY(-10px)', transition: 'opacity 500ms ease-out 200ms, transform 500ms ease-out 200ms' }}>
            <p className="terminal-line muted">$ whoami</p>
            <p className="terminal-line strong">guest</p>
            <p className="terminal-line muted terminal-gap">$ screenshare {command}<span className="cursor cursor--blink" /></p>
          </div>
          <div className="auth-form-panel" key={mode} style={{ opacity: formVisible ? 1 : 0, transform: formVisible ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 500ms ease-out 300ms, transform 500ms ease-out 300ms' }}>
            {isSignup && (
              <div className="field-group" style={{ animationDelay: '350ms' }}>
                <label className="field terminal-field">
                  <span>nome:</span>
                  <div className="input-group">
                    <input
                      type="text"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="seu nome"
                    />
                  </div>
                </label>
              </div>
            )}
            <div className="field-group" style={{ animationDelay: isSignup ? '400ms' : '350ms' }}>
              <label className="field terminal-field">
                <span>email:</span>
                <div className="input-group">
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="seu@email.com"
                  />
                </div>
              </label>
            </div>
            <div className="field-group" style={{ animationDelay: isSignup ? '450ms' : '400ms' }}>
              <label className="field terminal-field">
                <span>senha:</span>
                <div className="password-wrapper input-group">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    required
                    minLength={6}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="********"
                  />
                  <button type="button" className="icon-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "ocultar senha" : "mostrar senha"}>
                    {showPassword ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </label>
            </div>
            {isSignup && (
              <div className="field-group" style={{ animationDelay: '500ms' }}>
                <label className="field terminal-field">
                  <span>confirmar:</span>
                  <div className="input-group">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="********"
                    />
                  </div>
                </label>
              </div>
            )}
          </div>
          <Button icon={<IconChevronRight />} type="submit" disabled={loading} wide className="submit-btn" style={{ opacity: formVisible ? 1 : 0, transform: formVisible ? 'translateY(0)' : 'translateY(15px)', transition: 'opacity 500ms ease-out 550ms, transform 500ms ease-out 550ms' }}>
            {loading ? "aguarde" : isSignup ? "criar conta" : "entrar"}
          </Button>
          <div className="oauth-divider" style={{ opacity: formVisible ? 1 : 0, transform: formVisible ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity 400ms ease-out 650ms, transform 400ms ease-out 650ms' }}>
            <span>ou continue com</span>
          </div>
          <div className="oauth-buttons" style={{ opacity: formVisible ? 1 : 0, transform: formVisible ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity 400ms ease-out 700ms, transform 400ms ease-out 700ms' }}>
            <button className="oauth-button" onClick={() => submitProvider("google")} type="button" disabled={loading}>
              <span>[google]</span>
            </button>
            <button className="oauth-button" onClick={() => submitProvider("github")} type="button" disabled={loading}>
              <span>[github]</span>
            </button>
            <button className="oauth-button" onClick={() => submitProvider("discord")} type="button" disabled={loading}>
              <span>[discord]</span>
            </button>
          </div>
          {status ? <p className="auth-status" role="alert" style={{ opacity: formVisible ? 1 : 0, transition: 'opacity 300ms ease-out 800ms' }}>{status}</p> : null}
          <button className="auth-switch" type="button" disabled={loading} onClick={() => setMode(isSignup ? "login" : "signup")} style={{ opacity: formVisible ? 1 : 0, transform: formVisible ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity 400ms ease-out 800ms, transform 400ms ease-out 800ms' }}>
            {isSignup ? "ja tem uma conta? entrar" : "nao tem uma conta? cadastre-se"}
          </button>
        </form>
      </section>
    </div>
  );
}
