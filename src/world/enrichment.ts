import { worldId } from "./interpreter.js";
import {
  ATLAS_INTERPRETER_VERSION,
  ATLAS_WORLD_VERSION,
  type AtlasAssertion,
  type AtlasEntity,
  type AssertionClass,
  type InterpreterInput,
  type InterpreterManifest,
  type InterpreterOutput,
  type LocalDocumentation,
} from "./types.js";

export const LOCAL_DOCUMENTATION_NAMESPACE = "atlas.enrichment.local-docs";
export const localDocumentationManifest: InterpreterManifest = {
  protocolVersion: ATLAS_INTERPRETER_VERSION,
  ontologyVersion: ATLAS_WORLD_VERSION,
  id: LOCAL_DOCUMENTATION_NAMESPACE,
  version: "1.0.0",
  publisher: "atlas",
  displayName: "Local documentation enrichment",
  inputs: ["repository", "package", "configuration", "deployment"],
  outputKinds: ["capability"],
  outputPredicates: ["has-purpose", "declares-script", "declares-port", "provides-capability"],
  rules: [],
};

const authority: Record<AssertionClass, number> = {
  "user-defined": 5,
  observed: 4,
  declared: 3,
  derived: 2,
  inferred: 1,
};
export function selectAuthoritativeAssertion(assertions: AtlasAssertion[]) {
  return [...assertions].sort(
    (left, right) =>
      authority[right.classification] - authority[left.classification] ||
      right.confidence - left.confidence ||
      left.id.localeCompare(right.id),
  )[0];
}

const secret =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b|((?:token|secret|password|credential|authorization)\s*[=:]\s*)[^\s,;]+/gi;
const safe = (value: string) => value.replace(secret, (_match, prefix) => `${prefix ?? ""}[redacted]`);
const bounded = (text: string) => {
  if (text.includes("\0") || text.includes("\uFFFD")) return undefined;
  return Buffer.from(text, "utf8").subarray(0, 64 * 1024).toString("utf8");
};
const readmePurpose = (text: string) => {
  const lines = text.split(/\r?\n/), paragraph: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^[-=*]{3,}$/.test(line)) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(line);
    if (paragraph.join(" ").length >= 240) break;
  }
  return paragraph.join(" ").trim();
};

export function enrichFromLocalDocumentation(
  workload: AtlasEntity,
  inputs: InterpreterInput[],
  documents: LocalDocumentation[],
  clock = () => new Date().toISOString(),
): InterpreterOutput {
  const members = new Set(
      Array.isArray(workload.attributes.memberObservationIds)
        ? workload.attributes.memberObservationIds.map(String)
        : [],
    ),
    roots = new Set(
      inputs
        .filter((input) => members.has(input.id))
        .map((input) => input.attributes.repositoryPath)
        .filter((value): value is string => typeof value === "string"),
    ),
    scoped = documents
      .filter(
        (document) =>
          members.has(document.sourceInputId) || roots.has(document.repositoryPath),
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 10),
    assertions: AtlasAssertion[] = [],
    entities: AtlasEntity[] = [],
    at = clock();
  const assert = (
    document: LocalDocumentation,
    predicate: string,
    value: unknown,
    explanation: string,
    excerpt: string,
    confidence = 0.9,
  ) => {
    assertions.push({
      id: worldId(workload.contextId, LOCAL_DOCUMENTATION_NAMESPACE, "assertion", `${workload.id}:${predicate}:${document.path}:${String(value)}`),
      contextId: workload.contextId,
      subjectId: workload.id,
      predicate,
      value,
      classification: "declared",
      confidence,
      explanation,
      evidence: [{ observationId: document.observationId, sourceField: document.path, excerpt: safe(excerpt).slice(0, 240), method: "authorized-local-document" }],
      interpreterId: LOCAL_DOCUMENTATION_NAMESPACE,
      interpreterVersion: localDocumentationManifest.version,
      observedAt: workload.lastObservedAt,
      derivedAt: at,
      stale: workload.stale,
    });
  };
  for (const document of scoped) {
    const text = bounded(document.text);
    if (!text) continue;
    const name = document.path.split("/").at(-1) ?? document.path;
    if (/^readme(?:\.|$)/i.test(name)) {
      const purpose = safe(readmePurpose(text));
      if (purpose)
        assert(document, "has-purpose", purpose, "The workload purpose is declared by its local README.", purpose, 0.9);
      continue;
    }
    if (name === "package.json") {
      let manifest: any;
      try {
        manifest = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof manifest.description === "string" && manifest.description.trim())
        assert(document, "has-purpose", safe(manifest.description.trim()), "The package manifest declares the workload purpose.", manifest.description, 0.92);
      for (const [script, command] of Object.entries(manifest.scripts ?? {}).slice(0, 20)) {
        if (typeof command !== "string") continue;
        assert(document, "declares-script", script, "The package manifest declares an executable script.", `${script}: ${command}`, 0.95);
        const port = command.match(/(?:--port(?:=|\s+)|\bPORT=)(\d{2,5})\b/i)?.[1];
        if (port) assert(document, "declares-port", Number(port), "A package script declares a listening port.", `${script}: ${command}`, 0.8);
      }
      continue;
    }
    if (/^(?:fngk\.project|atlas\.deployment|deployment)\.json$/i.test(name)) {
      try {
        const manifest = JSON.parse(text), purpose = manifest.purpose ?? manifest.description;
        if (typeof purpose === "string" && purpose.trim())
          assert(document, "has-purpose", safe(purpose.trim()), "The deployment manifest declares the workload purpose.", purpose, 0.96);
      } catch {}
    }
  }
  return { entities, assertions, views: [] };
}
