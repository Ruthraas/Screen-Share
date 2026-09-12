// Contratos locais (UI): o que os componentes do cliente consomem hoje,
// com dados vindos de localData.ts/authClient.ts (issue #12).
export type Route = "login" | "empty" | "home" | "share" | "multi" | "settings" | "profile";
export type User = { id: string; name: string; email?: string; initials: string; online: boolean; sharing?: boolean; current?: boolean; photoURL?: string };
export type Group = { id: string; name: string; members: User[]; activeStreams: number };
export type Preferences = { theme: "dark" | "light"; notifications: boolean };
export type LocalProfile = { bio: string; photoURL?: string; name?: string };

// Contratos remotos (API, issue #60): espelham docs/backend/openapi.yaml.
// Ainda não são consumidos por nenhum componente — ficam prontos pra quando
// o cliente HTTP de grupos/convites/presença for implementado. Não confundir
// com os tipos locais acima: o backend não devolve `User` (initials, sharing,
// etc. são só de UI) nem um `Group` com `members: User[]` embutido.
export type Role = "owner" | "admin" | "member";

export type ApiGroup = {
  id: string;
  name: string;
  ownerId: string;
  role: Role;
  createdAt: string;
};

export type ApiGroupMember = { userId: string; role: Role };

export type ApiGroupDetail = ApiGroup & { members: ApiGroupMember[] };

export type Invite = {
  id: string;
  token: string;
  groupId: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
};

export type PresenceEntry = {
  userId: string;
  online: boolean;
  lastSeenAt: string;
};
