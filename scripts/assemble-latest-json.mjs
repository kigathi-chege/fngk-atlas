#!/usr/bin/env node
// Builds Tauri's static updater manifest (latest.json) from a release directory.
//
//   node scripts/assemble-latest-json.mjs DIR VERSION BASE_URL [NOTES]
//
// DIR holds the signed updater bundles and their .sig files, named as release
// CI renames them:
//   Atlas_<version>_amd64.AppImage(.sig)      -> linux-x86_64
//   Atlas_<version>_aarch64.AppImage(.sig)    -> linux-aarch64
//   Atlas_<version>_aarch64.app.tar.gz(.sig)  -> darwin-aarch64
//   Atlas_<version>_x64.app.tar.gz(.sig)      -> darwin-x86_64
// URLs are BASE_URL/<version>/<file>. Writes DIR/latest.json.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const targets = [
  { platform: "linux-x86_64", pattern: /_(amd64|x86_64)\.AppImage$/ },
  { platform: "linux-aarch64", pattern: /_aarch64\.AppImage$/ },
  { platform: "darwin-aarch64", pattern: /_aarch64\.app\.tar\.gz$/ },
  { platform: "darwin-x86_64", pattern: /_(x64|x86_64)\.app\.tar\.gz$/ },
];

export function assembleLatestJson(directory, version, baseUrl, { notes = "", pubDate = new Date().toISOString(), required = ["linux-x86_64", "linux-aarch64"] } = {}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Version "${version}" must be semantic without a v prefix.`);
  if (!baseUrl.startsWith("https://")) throw new Error("BASE_URL must use https://");
  const files = readdirSync(directory), platforms = {};
  for (const { platform, pattern } of targets) {
    const matches = files.filter(file => pattern.test(file));
    if (matches.length > 1) throw new Error(`More than one ${platform} bundle: ${matches.join(", ")}`);
    if (!matches.length) continue;
    const file = matches[0], signature = path.join(directory, `${file}.sig`);
    if (!existsSync(signature)) throw new Error(`${file} has no .sig; build with TAURI_SIGNING_PRIVATE_KEY.`);
    platforms[platform] = { signature: readFileSync(signature, "utf8").trim(), url: `${baseUrl.replace(/\/$/, "")}/${version}/${encodeURIComponent(file)}` };
  }
  const absent = required.filter(platform => !platforms[platform]);
  if (absent.length) throw new Error(`Missing required updater bundles: ${absent.join(", ")}`);
  return { version, notes, pub_date: pubDate, platforms };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, version, baseUrl, notes = ""] = process.argv.slice(2);
  if (!directory || !version || !baseUrl) { console.error("usage: assemble-latest-json.mjs DIR VERSION BASE_URL [NOTES]"); process.exit(2); }
  const manifest = assembleLatestJson(directory, version, baseUrl, { notes, required: (process.env.ATLAS_REQUIRED_PLATFORMS ?? "linux-x86_64,linux-aarch64").split(",").filter(Boolean) });
  writeFileSync(path.join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`latest.json: Atlas ${version} for ${Object.keys(manifest.platforms).join(", ")}`);
}
