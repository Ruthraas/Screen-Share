import type { Preferences, LocalProfile } from "../data/types";

export type SavedGroup = { id: string; name: string };
export type AccountData = { groups: SavedGroup[]; selectedId: string | null; profile: LocalProfile; preferences: Preferences };
export const emptyAccountData = (): AccountData => ({ groups: [], selectedId: null, profile: { bio: "" }, preferences: { theme: "dark", notifications: true } });
const key = (uid: string) => `screenshare.account.v1.${uid}`;

/**
 * Envelope versionado (issue #24): antes disso, o objeto salvo era o
 * próprio `AccountData` cru, sem versão — qualquer mudança de formato
 * futura apagaria os dados de todo mundo (a validação antiga caía direto
 * em `emptyAccountData()` sem tentar migrar). A partir de agora o valor
 * salvo é `{ version, data }`; dado antigo (sem envelope, salvo pelo
 * código anterior a esta issue) é reconhecido como `version: 1` — o
 * formato de dado em si não mudou, só ganhou o envelope por fora.
 */
const CURRENT_VERSION = 1;
type StoredEnvelope = { version: number; data: unknown };

/**
 * Uma função por versão, na ordem: a função no índice `v - 1` leva de
 * `data` na versão `v` pra versão `v + 1`. Só adicionar no fim quando o
 * formato mudar de verdade — nunca remover ou reescrever uma entrada já
 * publicada, senão dado salvo há tempo perde o caminho de migração.
 */
const MIGRATIONS: Array<(data: any) => unknown> = [];

function isValidAccountData(data: unknown): data is AccountData {
  const value = data as Partial<AccountData> | null | undefined;
  return !!value
    && Array.isArray(value.groups)
    && value.groups.every(group => typeof group?.id === "string" && typeof group?.name === "string")
    && typeof value.profile?.bio === "string"
    && (value.profile.name === undefined || typeof value.profile.name === "string")
    && ["dark", "light"].includes(value.preferences?.theme as string)
    && typeof value.preferences?.notifications === "boolean";
}

/** Aplica as migrações necessárias pra chegar em `CURRENT_VERSION`. Devolve
 * `null` (fallback seguro do chamador) quando a versão é mais nova do que
 * este código conhece, quando falta uma migração no meio do caminho, ou
 * quando o resultado final ainda não bate com o formato esperado. */
function migrate(version: number, data: unknown): AccountData | null {
  let current = data;
  for (let v = version; v < CURRENT_VERSION; v++) {
    const step = MIGRATIONS[v - 1];
    if (!step) return null;
    try {
      current = step(current);
    } catch {
      return null;
    }
  }
  return isValidAccountData(current) ? current : null;
}

export function readAccount(uid: string): AccountData {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return emptyAccountData();
    const parsed = JSON.parse(raw);
    const envelope: StoredEnvelope = parsed && typeof parsed === "object" && "version" in parsed && "data" in parsed
      ? (parsed as StoredEnvelope)
      : { version: 1, data: parsed }; // formato legado, sem envelope
    return migrate(envelope.version, envelope.data) ?? emptyAccountData();
  } catch {
    return emptyAccountData();
  }
}

export function writeAccount(uid: string, data: AccountData) {
  const envelope: StoredEnvelope = { version: CURRENT_VERSION, data };
  localStorage.setItem(key(uid), JSON.stringify(envelope));
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
