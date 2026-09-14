import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CreateGroupModal } from "./components/groups/CreateGroupModal";
import { JoinGroupModal } from "./components/groups/JoinGroupModal";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { SplashScreen } from "./components/layout/SplashScreen";
import { ErrorState, LoadingState } from "./components/ui/AsyncState";
import { EmptyState } from "./pages/EmptyState";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";
import { Settings } from "./pages/Settings";
import { Share } from "./pages/Share";
import { Groups } from "./pages/Groups";
import { MultiScreen } from "./pages/MultiScreen";
import "./styles.css";
import { CommandPalette } from "./components/layout/CommandPalette";
import { AccountProvider, useAccount, useSession } from "./components/layout/AccountProvider";
import { RtcProvider } from "./components/rtc/RtcProvider";
import { UpdateBanner } from "./components/update/UpdateBanner";
import { UpdateProvider } from "./components/update/UpdateProvider";
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
  // UpdateBanner fica fora do AppShell de propósito (issue #48: "não
  // altere UI fora do componente de atualização") — um componente
  // próprio, sobreposto, em vez de mexer no layout de cada página.
  // UpdateProvider precisa envolver tanto o AppShell (o ícone da sidebar,
  // `UpdateCheckButton`) quanto o banner — os dois usam a MESMA checagem,
  // não uma cada.
  return <AccountProvider key={session.user.id} account={session.user}><RtcProvider><UpdateProvider><AuthenticatedApp signedIn /><UpdateBanner /></UpdateProvider></RtcProvider></AccountProvider>;
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
  const { groups, groupsState, selected, reloadGroups } = useAccount();
  const [joinOpen, setJoinOpen] = useState(false);
  // issue #60: enquanto a lista real de grupos ainda está carregando, não
  // decide a rota com base numa lista vazia (senão sempre pisca "empty"
  // antes do fetch de verdade terminar, mesmo pra quem já tem grupos).
  const effectiveRoute = groupsState.status === "loading" ? route : routeAfterLogin(route, { groups, selectedId: selected?.id ?? null });
  useEffect(() => {
    if (groupsState.status !== "loading" && effectiveRoute !== route) navigate(effectiveRoute);
  }, [effectiveRoute, navigate, route, groupsState.status]);

  // "multi" (lista de grupos) nunca é sobre UM grupo especifico — não
  // mostra o titulo de um grupo só. "room" (a sala) é exatamente sobre
  // isso, junto de "home"/"share".
  const title = ["home", "share", "room"].includes(effectiveRoute) ? selected?.name : undefined;

  return (
    <AppShell route={effectiveRoute} navigate={navigate} title={title}>
      {groupsState.status === "loading" ? <LoadingState label="carregando grupos" /> : null}
      {groupsState.status === "error" ? <ErrorState message={groupsState.error.message} onRetry={reloadGroups} /> : null}
      {groupsState.status === "success" && (effectiveRoute === "home" || effectiveRoute === "share") ? (selected ? <Share navigate={navigate} /> : <EmptyState onCreate={() => setCreateOpen(true)} onJoin={() => setJoinOpen(true)} />) : null}
      {groupsState.status === "success" && effectiveRoute === "multi" ? <Groups onCreate={() => setCreateOpen(true)} onJoin={() => setJoinOpen(true)} onOpenRoom={() => navigate("room")} /> : null}
      {groupsState.status === "success" && effectiveRoute === "room" ? (selected ? <MultiScreen onBack={() => navigate("multi")} /> : null) : null}
      {groupsState.status === "success" && effectiveRoute === "settings" ? <Settings onEditProfile={() => navigate("profile")} /> : null}
      {groupsState.status === "success" && effectiveRoute === "profile" ? <Profile /> : null}
      {groupsState.status === "success" && effectiveRoute === "empty" ? <EmptyState onCreate={() => setCreateOpen(true)} onJoin={() => setJoinOpen(true)} /> : null}
      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); navigate("room"); }} />
      <JoinGroupModal open={joinOpen} onClose={() => setJoinOpen(false)} onJoined={() => { setJoinOpen(false); navigate("room"); }} />
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
