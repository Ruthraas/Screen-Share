import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CreateGroupModal } from "./components/groups/CreateGroupModal";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { SplashScreen } from "./components/layout/SplashScreen";
import { EmptyState } from "./pages/EmptyState";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";
import { Settings } from "./pages/Settings";
import { Share } from "./pages/Share";
import { Groups } from "./pages/Groups";
import "./styles.css";
import { CommandPalette } from "./components/layout/CommandPalette";
import { AccountProvider, useAccount, useSession } from "./components/layout/AccountProvider";
import type { Route } from "./data/types";
import { parseRouteHash, routeAfterLogin, routeForSignedOut, sessionView } from "./services/sessionRouting";

function routeFromHash(): Route {
  return parseRouteHash(window.location.hash);
}

function App() {
  const session = useSession();
  const view = sessionView(session);
  if (view === "loading") return <div className="app-frame"><SplashScreen leaving={false} /></div>;
  if (view === "login") return <AuthenticatedApp signedIn={false} sessionError={session.error ?? undefined} />;
  if (!session.user) return <AuthenticatedApp signedIn={false} sessionError={session.error ?? undefined} />;
  return <AccountProvider key={session.user.id} account={session.user}><AuthenticatedApp signedIn /></AccountProvider>;
}

function AuthenticatedApp({ signedIn, sessionError }: { signedIn: boolean; sessionError?: string }) {
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [createOpen, setCreateOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  const [showSplash, setShowSplash] = useState(true);
  const [splashLeaving, setSplashLeaving] = useState(false);

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    const exitTimer = window.setTimeout(() => setSplashLeaving(true), 3200);
    const doneTimer = window.setTimeout(() => setShowSplash(false), 4000);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  const navigate = useCallback((next: Route) => {
    setRoute(next);
    window.history.replaceState(null, "", `#/${next}`);
  }, []);

  useEffect(() => {
    if (!signedIn) {
      const publicRoute = routeForSignedOut(route);
      if (route !== publicRoute) navigate(publicRoute);
    }
  }, [navigate, route, signedIn]);

  if (!signedIn) {
    return (
      <AppFrame ready={!showSplash}>
        <Login sessionError={sessionError} />
        {showSplash ? <SplashScreen leaving={splashLeaving} /> : null}
      </AppFrame>
    );
  }

  return (
    <AppFrame ready={!showSplash}>
      <Workspace route={route === "login" ? "home" : route} navigate={navigate} createOpen={createOpen} setCreateOpen={setCreateOpen} paletteOpen={paletteOpen} setPaletteOpen={setPaletteOpen} />
      {showSplash ? <SplashScreen leaving={splashLeaving} /> : null}
    </AppFrame>
  );
}

function Workspace({ route, navigate, createOpen, setCreateOpen, paletteOpen, setPaletteOpen }: { route: Route; navigate: (route: Route) => void; createOpen: boolean; setCreateOpen: (value: boolean) => void; paletteOpen: boolean; setPaletteOpen: (value: boolean) => void }) {
  const { groups, selected } = useAccount();
  const effectiveRoute = routeAfterLogin(route, { groups, selectedId: selected?.id ?? null });
  useEffect(() => {
    if (effectiveRoute !== route) navigate(effectiveRoute);
  }, [effectiveRoute, navigate, route]);

  return (
    <AppShell
      route={effectiveRoute}
      navigate={navigate}
      title={["home", "share", "multi"].includes(effectiveRoute) ? selected?.name : undefined}
    >
      {effectiveRoute === "home" || effectiveRoute === "share" ? selected ? <Share navigate={navigate} /> : <EmptyState onCreate={() => setCreateOpen(true)} onJoin={() => navigate("multi")} /> : null}
      {effectiveRoute === "multi" ? <Groups onCreate={() => setCreateOpen(true)} /> : null}
      {effectiveRoute === "settings" ? <Settings onEditProfile={() => navigate("profile")} /> : null}
      {effectiveRoute === "profile" ? <Profile /> : null}
      {effectiveRoute === "empty" ? <EmptyState onCreate={() => setCreateOpen(true)} onJoin={() => navigate("home")} /> : null}
      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); navigate("share"); }} />
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} onAction={action => { setPaletteOpen(false); if (action === "create") setCreateOpen(true); else navigate(action as Route); }} /> : null}
    </AppShell>
  );
}

function AppFrame({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return <div className={`app-frame ${ready ? "is-ready" : ""}`}>{children}</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
