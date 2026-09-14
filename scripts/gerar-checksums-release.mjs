#!/usr/bin/env node
// Issue #49: gera checksums SHA256 do executável e do instalador NSIS já
// construídos localmente pelo passo anterior (tauri-action) e anexa como
// asset extra na release (já criada, ainda em rascunho) — "origem
// rastreável" sem depender de confiar cegamente no binário baixado.

import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tag) {
  console.error("Uso: node gerar-checksums-release.mjs <tag> (ou defina GITHUB_REF_NAME)");
  process.exit(1);
}

const nsisDir = "src-tauri/target/release/bundle/nsis";
const nsisArquivos = existsSync(nsisDir)
  ? readdirSync(nsisDir)
      .filter((f) => f.endsWith(".exe"))
      .map((f) => path.join(nsisDir, f))
  : [];

const candidatos = ["src-tauri/target/release/ScreenShare.exe", ...nsisArquivos];
const arquivos = candidatos.filter((p) => existsSync(p));

if (arquivos.length === 0) {
  console.error("Nenhum artefato encontrado pra gerar checksum — build falhou antes desta etapa?");
  process.exit(1);
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

const linhas = [];
for (const arquivo of arquivos) {
  const digest = await sha256(arquivo);
  linhas.push(`${digest}  ${path.basename(arquivo)}`);
}

const conteudo = linhas.join("\n") + "\n";
const outPath = "checksums.txt";
writeFileSync(outPath, conteudo, "utf8");
console.log(conteudo);

execFileSync("gh", ["release", "upload", tag, outPath, "--clobber"], { stdio: "inherit" });
