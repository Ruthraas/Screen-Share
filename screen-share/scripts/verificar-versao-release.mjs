#!/usr/bin/env node
// Issue #49: interrompe o workflow de release se a tag e as três fontes de
// versão do app (package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json)
// não baterem entre si — exigência explícita da issue ("Versões divergentes
// interrompem o workflow"), pra nunca publicar um instalador com uma versão
// e um manifesto de update com outra.

import { readFileSync } from "node:fs";

const tagArg = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (!tagArg) {
  console.error("Uso: node verificar-versao-release.mjs <tag> (ou defina GITHUB_REF_NAME)");
  process.exit(1);
}

const tagVersion = tagArg.replace(/^v/, "");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");

const cargoMatch = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) {
  console.error("Não encontrei 'version' na seção [package] de src-tauri/Cargo.toml");
  process.exit(1);
}
const cargoVersion = cargoMatch[1];

const fontes = {
  "tag (git)": tagVersion,
  "package.json": packageJson.version,
  "src-tauri/Cargo.toml": cargoVersion,
  "src-tauri/tauri.conf.json": tauriConf.version,
};

const valoresUnicos = new Set(Object.values(fontes));
if (valoresUnicos.size > 1) {
  console.error("Versões divergentes entre as fontes — corrija antes de marcar a tag de novo:");
  for (const [fonte, valor] of Object.entries(fontes)) {
    console.error(`  ${fonte}: ${valor}`);
  }
  process.exit(1);
}

console.log(`Versão consistente em todas as fontes: ${tagVersion}`);
