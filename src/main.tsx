import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CreateGroupModal } from "./components/groups/CreateGroupModal";
import { AppShell } from "./components/layout/AppShell";
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

function routeFromHash(): Route {
  const value = window.location.hash.replace("#/", "") as Route;
  return value || "login";
}

function App() {
  const session = useSession();
  if (!session.ready) return <div className="app-frame"><SplashScreen leaving={false} /></div>;
  if (!session.user) return <AuthenticatedApp signedIn={false} />;
  return <AccountProvider key={session.user.uid} account={session.user}><AuthenticatedApp signedIn /></AccountProvider>;
}

function AuthenticatedApp({ signedIn }: { signedIn: boolean }) {
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

  const navigate = (next: Route) => {
    setRoute(next);
    window.history.replaceState(null, "", `#/${next}`);
  };

  if (!signedIn) {
    return (
      <AppFrame ready={!showSplash}>
        <Login navigate={() => navigate("home")} />
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
  const { selected } = useAccount();
  return (
    <AppShell
      route={route}
      navigate={navigate}
      title={["home", "share", "multi"].includes(route) ? selected?.name : undefined}
    >
      {route === "home" || route === "share" ? selected ? <Share navigate={navigate} /> : <EmptyState onCreate={() => setCreateOpen(true)} onJoin={() => navigate("multi")} /> : null}
      {route === "multi" ? <Groups onCreate={() => setCreateOpen(true)} /> : null}
      {route === "settings" ? <Settings onEditProfile={() => navigate("profile")} /> : null}
      {route === "profile" ? <Profile /> : null}
      {route === "empty" ? <EmptyState onCreate={() => setCreateOpen(true)} onJoin={() => navigate("home")} /> : null}
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
    <App />
  </StrictMode>,
);
