#!/usr/bin/env node
// Writes desktop/src-tauri/tauri.generated.conf.json, merged over tauri.conf.json
// by `npm run desktop:build`. It carries everything that differs per build:
//
//   ATLAS_VERSION                 app version (default: exact `v*` git tag at HEAD,
//                                 else package.json version + "-dev")
//   ATLAS_UPDATER_PUBKEY          updater public key override (dev keys only; release
//                                 builds use the key pinned in tauri.conf.json)
//   ATLAS_UPDATER_ALLOW_INSECURE  "1" allows an http:// update endpoint (local tests only)
//   TAURI_SIGNING_PRIVATE_KEY     when set, Tauri also writes signed updater artifacts
//   ATLAS_RELEASE                 "1" in release CI: refuses the dev overrides above
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function resolveVersion(env = process.env, tag = gitTag(), pkg = readJson("package.json").version) {
  const raw = env.ATLAS_VERSION || tag || `${pkg}-dev`;
  const version = raw.replace(/^v/, "");
  if (!semver.test(version)) throw new Error(`Atlas version "${raw}" is not a semantic version.`);
  return version;
}

export function desktopConfig(env = process.env, version = resolveVersion(env)) {
  if (env.ATLAS_RELEASE === "1" && (env.ATLAS_UPDATER_PUBKEY || env.ATLAS_UPDATER_ALLOW_INSECURE === "1")) throw new Error("A release build (ATLAS_RELEASE=1) must use the pinned updater key over HTTPS; unset ATLAS_UPDATER_PUBKEY and ATLAS_UPDATER_ALLOW_INSECURE.");
  const updater = {};
  if (env.ATLAS_UPDATER_PUBKEY) updater.pubkey = env.ATLAS_UPDATER_PUBKEY.trim();
  if (env.ATLAS_UPDATER_ALLOW_INSECURE === "1") updater.dangerousInsecureTransportProtocol = true;
  return {
    version,
    bundle: { createUpdaterArtifacts: Boolean(env.TAURI_SIGNING_PRIVATE_KEY) },
    ...(Object.keys(updater).length ? { plugins: { updater } } : {}),
  };
}

function gitTag() {
  try { return execFileSync("git", ["describe", "--tags", "--exact-match", "--match", "v*", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}

function readJson(file) { return JSON.parse(readFileSync(path.join(root, file), "utf8")); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = desktopConfig();
  const target = path.join(root, "desktop/src-tauri/tauri.generated.conf.json");
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Atlas desktop ${config.version} (updater artifacts: ${config.bundle.createUpdaterArtifacts ? "signed" : "off"}) -> ${path.relative(root, target)}`);
}
