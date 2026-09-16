import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

/**
 * Ponte fina pro plugin oficial de updater do Tauri (issue #48) — canal e
 * manifesto já publicados pela infraestrutura (issue #49,
 * `plugins.updater` em `tauri.conf.json`: pubkey + endpoint do
 * `latest.json`). `check()` já faz a comparação semver de verdade (só
 * devolve um `Update` quando a versão remota é maior) e já rejeita
 * manifesto/assinatura inválidos (lança erro, nunca devolve um update não
 * verificado) — nada disso é reimplementado aqui.
 *
 * No Windows (único alvo deste produto, ver README), `Update.install()`/
 * `downloadAndInstall()` já encerram o processo sozinhos depois de lançar
 * o instalador — não precisa do plugin `process`/`relaunch()`.
 */
export type UpdateInfo = { version: string; currentVersion: string; notes?: string };

export async function checkForUpdate(): Promise<{ update: Update; info: UpdateInfo } | null> {
  if (!isTauri()) return null; // updater só existe dentro do app empacotado
  const update = await check();
  if (!update) return null;
  return { update, info: { version: update.version, currentVersion: update.currentVersion, notes: update.body } };
}

export type DownloadProgress = { downloadedBytes: number; totalBytes: number | null };

export async function downloadAndInstallUpdate(update: Update, onProgress: (progress: DownloadProgress) => void): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  onProgress({ downloadedBytes: 0, totalBytes: null });
  await update.downloadAndInstall(event => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress({ downloadedBytes: 0, totalBytes: total });
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress({ downloadedBytes: downloaded, totalBytes: total });
    }
  });
}
