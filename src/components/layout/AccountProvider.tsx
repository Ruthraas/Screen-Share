import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, updateProfile, type User as FirebaseUser } from "firebase/auth";
import { auth } from "../../services/firebase";
import { readAccount, writeAccount, type AccountData, type SavedGroup } from "../../services/localData";
import type { Group, Preferences, User } from "../../data/types";

type Account = {
  user: User; groups: Group[]; selected: Group | undefined; bio: string; preferences: Preferences;
  createGroup: (name: string) => void; selectGroup: (id: string) => void;
  saveProfile: (name: string, bio: string, photoURL?: string) => Promise<void>;
  setPreferences: (value: Preferences) => void; logout: () => Promise<void>;
};
const Context = createContext<Account | null>(null);
export const useAccount = () => { const value = useContext(Context); if (!value) throw new Error("account-required"); return value; };

export function useSession() {
  const [session, setSession] = useState<{ ready: boolean; user: FirebaseUser | null }>({ ready: !auth, user: null });
  useEffect(() => auth ? onAuthStateChanged(auth, user => setSession({ ready: true, user }), () => setSession({ ready: true, user: null })) : undefined, []);
  return session;
}

function toGroup(saved: SavedGroup, currentUser: User): Group {
  return { id: saved.id, name: saved.name, members: [currentUser], activeStreams: 0 };
}

export function AccountProvider({ account, children }: { account: FirebaseUser; children: ReactNode }) {
  const [data, setData] = useState(() => readAccount(account.uid));
  const [name, setName] = useState(account.displayName ?? "");
  const commit = (next: AccountData) => { writeAccount(account.uid, next); setData(next); };
  useEffect(() => { document.documentElement.dataset.theme = data.preferences.theme; }, [data.preferences.theme]);
  const displayName = name || account.email?.split("@")[0] || "usuario";
  const user: User = { id: account.uid, name: displayName, email: account.email ?? undefined, initials: displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(), online: true, current: true, photoURL: data.profile.photoURL || account.photoURL || undefined };
  const groups = data.groups.map(saved => toGroup(saved, user));
  const value: Account = {
    user, groups, selected: groups.find(group => group.id === data.selectedId), bio: data.profile.bio, preferences: data.preferences,
    createGroup(name) { const trimmed = name.trim(); if (!trimmed) throw new Error("informe o nome do grupo"); const group = { id: crypto.randomUUID(), name: trimmed }; commit({ ...data, groups: [...data.groups, group], selectedId: group.id }); },
    selectGroup(id) { if (data.groups.some(group => group.id === id)) commit({ ...data, selectedId: id }); },
    async saveProfile(name, bio, photoURL) { const trimmed = name.trim(); if (!trimmed) throw new Error("informe seu nome"); await updateProfile(account, { displayName: trimmed }); commit({ ...data, profile: { bio, photoURL } }); setName(trimmed); },
    setPreferences(preferences) { commit({ ...data, preferences }); },
    async logout() { if (auth) await signOut(auth); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
