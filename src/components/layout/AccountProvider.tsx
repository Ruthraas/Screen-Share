import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentSession, getSessionError, logout as logoutSession, restoreSession, subscribeSession, type SessionUser } from "../../services/authClient";
import { emptyAccountData, persistDeviceTheme, readAccount, writeAccount, type AccountData, type SavedGroup } from "../../services/localData";
import type { Group, Preferences, User } from "../../data/types";
import type { SessionState } from "../../services/sessionRouting";

type Account = {
  user: User; groups: Group[]; selected: Group | undefined; bio: string; preferences: Preferences;
  createGroup: (name: string) => void; selectGroup: (id: string) => void;
  saveProfile: (name: string, bio: string, photoURL?: string) => Promise<void>;
  setPreferences: (value: Preferences) => void; logout: () => Promise<void>;
};
const Context = createContext<Account | null>(null);
export const useAccount = () => { const value = useContext(Context); if (!value) throw new Error("account-required"); return value; };

/**
 * Fonte da sessão (issue #2): não é mais `onAuthStateChanged` do Firebase,
 * e sim o estado observável de `authClient`, alimentado pela tentativa de
 * restauração via refresh token na abertura e por login/logout explícitos.
 */
export function useSession() {
  const [session, setSessionState] = useState<SessionState<SessionUser>>({ ready: false, user: getCurrentSession()?.user ?? null, error: null });

  useEffect(() => {
    const unsubscribe = subscribeSession(user => {
      setSessionState({ ready: true, user, error: user ? null : getSessionError() });
    });
    restoreSession().finally(() => {
      setSessionState(current => (current.ready ? current : { ready: true, user: getCurrentSession()?.user ?? null, error: getSessionError() }));
    });
    return unsubscribe;
  }, []);

  return session;
}

function toGroup(saved: SavedGroup, currentUser: User): Group {
  return { id: saved.id, name: saved.name, members: [currentUser], activeStreams: 0 };
}

export function AccountProvider({ account, children }: { account: SessionUser; children: ReactNode }) {
  const [data, setData] = useState(() => readAccount(account.id));
  const commit = (next: AccountData) => { writeAccount(account.id, next); setData(next); };
  useEffect(() => {
    document.documentElement.dataset.theme = data.preferences.theme;
    persistDeviceTheme(data.preferences.theme);
  }, [data.preferences.theme]);
  const displayName = data.profile.name || account.email?.split("@")[0] || "usuario";
  const user: User = { id: account.id, name: displayName, email: account.email, initials: displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(), online: true, current: true, photoURL: data.profile.photoURL };
  const groups = data.groups.map(saved => toGroup(saved, user));
  const value: Account = {
    user, groups, selected: groups.find(group => group.id === data.selectedId), bio: data.profile.bio, preferences: data.preferences,
    createGroup(name) { const trimmed = name.trim(); if (!trimmed) throw new Error("informe o nome do grupo"); const group = { id: crypto.randomUUID(), name: trimmed }; commit({ ...data, groups: [...data.groups, group], selectedId: group.id }); },
    selectGroup(id) { if (data.groups.some(group => group.id === id)) commit({ ...data, selectedId: id }); },
    async saveProfile(name, bio, photoURL) { const trimmed = name.trim(); if (!trimmed) throw new Error("informe seu nome"); commit({ ...data, profile: { ...data.profile, name: trimmed, bio, photoURL } }); },
    setPreferences(preferences) { commit({ ...data, preferences }); },
    async logout() { setData(emptyAccountData()); await logoutSession(); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
