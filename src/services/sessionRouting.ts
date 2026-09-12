import type { Route } from "../data/types";
import type { AccountData } from "./localData";

export type SessionState<TUser = unknown> = {
  ready: boolean;
  user: TUser | null;
  error: string | null;
};

export type SessionView = "loading" | "login" | "app";

const protectedRoutes = new Set<Route>(["empty", "home", "share", "multi", "settings", "profile"]);

export function sessionView(session: SessionState) {
  if (!session.ready) return "loading";
  if (!session.user) return "login";
  return "app";
}

export function parseRouteHash(hash: string): Route {
  const value = hash.replace(/^#\/?/, "");
  return isRoute(value) ? value : "login";
}

export function isProtectedRoute(route: Route) {
  return protectedRoutes.has(route);
}

export function routeAfterLogin(requested: Route, account: Pick<AccountData, "groups" | "selectedId">): Route {
  if (requested === "settings" || requested === "profile" || requested === "multi") return requested;
  if (account.groups.length === 0) return "empty";
  if (requested === "share" && account.selectedId) return "share";
  return "home";
}

export function routeForSignedOut(requested: Route): Route {
  return isProtectedRoute(requested) ? "login" : requested;
}

function isRoute(value: string): value is Route {
  return ["login", "empty", "home", "share", "multi", "settings", "profile"].includes(value);
}
