import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getCurrentSession, getSessionError, logout as logoutSession, restoreSession, subscribeSession, type SessionUser } from "../../services/authClient";
import { emptyAccountData, persistDeviceTheme, readAccount, writeAccount, type AccountData } from "../../services/localData";
import { ApiError, acceptInvite as apiAcceptInvite, createGroup as apiCreateGroup, createInvite as apiCreateInvite, deleteGroup as apiDeleteGroup, getGroup as apiGetGroup, getPresence, leaveGroup as apiLeaveGroup, listGroups as apiListGroups, sendPresenceHeartbeat } from "../../services/groupsApi";
import type { ApiGroup, Group, Preferences, User } from "../../data/types";
import type { SessionState } from "../../services/sessionRouting";

export type GroupsState = { status: "loading" } | { status: "error"; error: ApiError } | { status: "success" };
export type SelectedGroupState = { status: "idle" } | { status: "loading" } | { status: "error"; error: ApiError } | { status: "success" };

/** Bem abaixo do TTL de presença do backend (30s, `backend/src/presence/store.ts`)
 * — precisa sobrar folga real pra uma chamada lenta/perdida não deixar a
 * própria sessão expirar entre um heartbeat e o outro. */
const PRESENCE_POLL_INTERVAL_MS = 10_000;

type Account = {
  user: User;
  groupsState: GroupsState;
  groups: Group[];
  selected: Group | undefined;
  selectedState: SelectedGroupState;
  bio: string;
  preferences: Preferences;
  createGroup: (name: string) => Promise<void>;
  selectGroup: (id: string) => void;
  leaveGroup: (id: string) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  createInviteLink: () => Promise<string>;
  acceptInvite: (token: string) => Promise<void>;
  reloadGroups: () => void;
  saveProfile: (name: string, bio: string, photoURL?: string) => Promise<void>;
  setPreferences: (value: Preferences) => void;
  logout: () => Promise<void>;
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

/** O backend não devolve nome/foto de outros membros (sem endpoint de
 * perfil público) — mostrar um rótulo curto derivado do próprio id em vez
 * de inventar um nome. Gap real, não mock: documentado no comentário do
 * `groupsApi.ts` e na issue #60. */
function memberLabel(userId: string): string {
  return userId.length > 10 ? `usuario ${userId.slice(-6)}` : userId;
}

function toGroup(api: ApiGroup): Group {
  return { id: api.id, name: api.name, members: [], role: api.role };
}

export function AccountProvider({ account, children }: { account: SessionUser; children: ReactNode }) {
  const [data, setData] = useState(() => readAccount(account.id));
  const [groupsState, setGroupsState] = useState<GroupsState>({ status: "loading" });
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<{ id: string; members: User[] } | null>(null);
  const [selectedState, setSelectedState] = useState<SelectedGroupState>({ status: "idle" });

  const commit = (next: AccountData) => { writeAccount(account.id, next); setData(next); };
  useEffect(() => {
    document.documentElement.dataset.theme = data.preferences.theme;
    persistDeviceTheme(data.preferences.theme);
  }, [data.preferences.theme]);

  // Prioridade: nome/foto salvos localmente (usuário editou em "perfil") >
  // nome/foto do provedor OAuth (issue #70, backend — só existe pra quem
  // já logou via Google/GitHub/Discord) > local-part do e-mail > fallback.
  const displayName = data.profile.name || account.displayName || account.email?.split("@")[0] || "usuario";
  const photoURL = data.profile.photoURL || account.avatarUrl;
  const user: User = { id: account.id, name: displayName, email: account.email, initials: displayName.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(), online: true, current: true, photoURL };

  async function loadGroups() {
    setGroupsState({ status: "loading" });
    try {
      const apiGroups = await apiListGroups();
      setGroups(apiGroups.map(toGroup));
      setGroupsState({ status: "success" });
    } catch (error) {
      setGroups([]);
      setGroupsState({ status: "error", error: error instanceof ApiError ? error : new ApiError("unknown", "nao foi possivel carregar seus grupos", 0) });
    }
  }

  // issue #60: buscar os grupos reais assim que a conta autenticada estiver
  // disponível; roda de novo se a conta trocar (troca de sessão/uid).
  useEffect(() => {
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  // Detalhe (membros) do grupo selecionado — só existe na API via
  // getGroup(id), não vem na listagem (issue #60: ApiGroup não tem members).
  useEffect(() => {
    const selectedId = data.selectedId;
    if (!selectedId || !groups.some(group => group.id === selectedId)) {
      setSelectedDetail(null);
      setSelectedState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setSelectedState({ status: "loading" });
    apiGetGroup(selectedId).then(
      detail => {
        if (cancelled) return;
        const members: User[] = detail.members.map(member =>
          member.userId === account.id
            ? user
            : { id: member.userId, name: memberLabel(member.userId), initials: member.userId.slice(-2).toUpperCase(), online: false, current: false },
        );
        setSelectedDetail({ id: selectedId, members });
        setSelectedState({ status: "success" });
      },
      error => {
        if (cancelled) return;
        setSelectedDetail(null);
        setSelectedState({ status: "error", error: error instanceof ApiError ? error : new ApiError("unknown", "nao foi possivel carregar os membros do grupo", 0) });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.selectedId, groups]);

  // Presença real (issue backend #36, nunca consumida pelo cliente antes) —
  // heartbeat + consulta periódica pra saber quem do grupo selecionado
  // está online de verdade agora, em vez do `online: false` fixo que todo
  // membro (menos o próprio usuário) sempre teve. Só heartbeata o grupo
  // SELECIONADO (é o único que faz sentido dizer "estou aqui agora"); a
  // lista de grupos usa uma leitura sem heartbeat (`Groups.tsx`).
  useEffect(() => {
    const selectedId = data.selectedId;
    if (!selectedId) return;
    let cancelled = false;
    async function tick() {
      try {
        await sendPresenceHeartbeat(selectedId as string);
        const entries = await getPresence(selectedId as string);
        if (cancelled) return;
        const onlineIds = new Set(entries.filter(entry => entry.online).map(entry => entry.userId));
        setSelectedDetail(current =>
          current && current.id === selectedId
            ? { ...current, members: current.members.map(member => ({ ...member, online: member.id === account.id ? true : onlineIds.has(member.id) })) }
            : current,
        );
      } catch {
        // Presença é um extra — nunca deve derrubar a tela por falhar.
      }
    }
    void tick();
    const interval = setInterval(() => void tick(), PRESENCE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.selectedId]);

  const selectedGroup = groups.find(group => group.id === data.selectedId);
  const selected: Group | undefined = selectedGroup && selectedDetail?.id === selectedGroup.id
    ? { ...selectedGroup, members: selectedDetail.members }
    : selectedGroup;

  const value: Account = {
    user, groupsState, groups, selected, selectedState, bio: data.profile.bio, preferences: data.preferences,
    async createGroup(name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("informe o nome do grupo");
      const created = await apiCreateGroup(trimmed);
      await loadGroups();
      commit({ ...data, selectedId: created.id });
    },
    selectGroup(id) {
      if (groups.some(group => group.id === id)) commit({ ...data, selectedId: id });
    },
    async leaveGroup(id) {
      await apiLeaveGroup(id);
      if (data.selectedId === id) commit({ ...data, selectedId: null });
      await loadGroups();
    },
    async deleteGroup(id) {
      await apiDeleteGroup(id);
      if (data.selectedId === id) commit({ ...data, selectedId: null });
      await loadGroups();
    },
    async createInviteLink() {
      if (!data.selectedId) throw new Error("selecione um grupo primeiro");
      const invite = await apiCreateInvite(data.selectedId);
      return invite.token;
    },
    async acceptInvite(token) {
      const group = await apiAcceptInvite(token.trim());
      await loadGroups();
      commit({ ...data, selectedId: group.id });
    },
    reloadGroups() {
      void loadGroups();
    },
    async saveProfile(name, bio, photoURL) { const trimmed = name.trim(); if (!trimmed) throw new Error("informe seu nome"); commit({ ...data, profile: { ...data.profile, name: trimmed, bio, photoURL } }); },
    setPreferences(preferences) { commit({ ...data, preferences }); },
    async logout() { setData(emptyAccountData()); await logoutSession(); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
