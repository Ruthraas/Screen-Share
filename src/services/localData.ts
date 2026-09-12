import type { Preferences, LocalProfile } from "../data/types";

export type SavedGroup = { id: string; name: string };
export type AccountData = { groups: SavedGroup[]; selectedId: string | null; profile: LocalProfile; preferences: Preferences };
export const emptyAccountData = (): AccountData => ({ groups: [], selectedId: null, profile: { bio: "" }, preferences: { theme: "dark", notifications: true } });
const key = (uid: string) => `screenshare.account.v1.${uid}`;

export function readAccount(uid: string): AccountData {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return emptyAccountData();
    const data = JSON.parse(raw) as AccountData;
    if (!Array.isArray(data.groups) || !data.groups.every(group => typeof group.id === "string" && typeof group.name === "string") || typeof data.profile?.bio !== "string" || (data.profile.name !== undefined && typeof data.profile.name !== "string") || !["dark", "light"].includes(data.preferences?.theme) || typeof data.preferences?.notifications !== "boolean") return emptyAccountData();
    return data;
  } catch { return emptyAccountData(); }
}

export function writeAccount(uid: string, data: AccountData) {
  localStorage.setItem(key(uid), JSON.stringify(data));
}

const DEVICE_THEME_KEY = "screenshare.theme";

/** Espelho do tema ativo fora do namespace por conta — lido de forma
 * síncrona pelo script inline em index.html antes da primeira pintura
 * (issue #15), já que a preferência "de verdade" só fica disponível depois
 * que a sessão restaura (assíncrono) e a conta é conhecida. Se a chave
 * mudar de nome, atualizar o script inline em index.html junto. */
export function persistDeviceTheme(theme: Preferences["theme"]) {
  try {
    localStorage.setItem(DEVICE_THEME_KEY, theme);
  } catch {
    // localStorage indisponível (ex.: modo privado) — só perde a restauração pré-pintura.
  }
}
