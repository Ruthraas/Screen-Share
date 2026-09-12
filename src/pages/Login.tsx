import { useState, useEffect, useRef } from "react";
import { Button } from "../components/ui/Button";
import { IconChevronRight, IconEye, IconEyeOff, IconMail, IconLock, IconUser } from "../components/ui/Icons";
import {
  authErrorMessage,
  createAccountWithEmail,
  loginWithEmail,
  loginWithGithub,
  loginWithGoogle,
} from "../services/firebase";

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  speed: number;
  angle: number;
  twinkleDelay: number;
  twinkleSpeed: number;
}

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
  const starsRef = useRef<Star[]>([]);

  useEffect(() => {
    starsRef.current = Array.from({ length: 60 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 0.5 + Math.random() * 2.5,
      opacity: 0.1 + Math.random() * 0.4,
      speed: 0.02 + Math.random() * 0.04,
      angle: Math.random() * Math.PI * 2,
      twinkleDelay: Math.random() * 4,
      twinkleSpeed: 0.5 + Math.random() * 1.5,
    }));
  }, []);

  useEffect(() => {
    setFormVisible(false);
    setTimeout(() => setFormVisible(true), 200);
  }, [mode]);

  useEffect(() => {
    if (sessionError) setStatus(authErrorMessage(Object.assign(new Error(sessionError), { code: sessionError })));
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
        await createAccountWithEmail(name, email, password);
      } else {
        await loginWithEmail(email, password);
      }

    } catch (error) {
      setStatus(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function submitProvider(provider: "google" | "github") {
    setStatus("");
    setStatus("continue o login na janela do navegador");
    setLoading(true);

    try {
      if (provider === "google") {
        await loginWithGoogle();
      } else {
        await loginWithGithub();
      }

    } catch (error) {
      setStatus(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-stage">
      <div className="login-bg" aria-hidden="true">
        <div className="login-gradient" />
        <div className="login-stars">
          {starsRef.current.map((s, i) => (
            <div
              key={i}
              className="login-star"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.size,
                height: s.size,
                opacity: s.opacity,
                '--angle': `${s.angle}rad`,
                '--speed': `${s.speed}s`,
                '--twinkle-delay': `${s.twinkleDelay}s`,
                '--twinkle-speed': `${s.twinkleSpeed}s`,
              } as any}
            />
          ))}
        </div>
        <div className="login-nebula" />
      </div>
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
                  <span>nome</span>
                  <div className="input-group">
                    <IconUser className="input-icon" />
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
                <span>email</span>
                <div className="input-group">
                  <IconMail className="input-icon" />
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
                <span>senha</span>
                <div className="password-wrapper input-group">
                  <IconLock className="input-icon" />
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
                  <span>confirmar</span>
                  <div className="input-group">
                    <IconLock className="input-icon" />
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
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              <span>google</span>
            </button>
            <button className="oauth-button" onClick={() => submitProvider("github")} type="button" disabled={loading}>
              <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.299 24 12c0-6.627-5.373-12-12-12z"/></svg>
              <span>github</span>
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
