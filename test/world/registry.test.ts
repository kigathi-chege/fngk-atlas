import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  interpreterSigningPayload,
  loadInterpreterRegistry,
} from "../../src/world/registry.js";
import {
  validateInterpreterManifest,
  workloadInterpreter,
} from "../../src/world/interpreter.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});

describe("interpreter registry", () => {
  it("accepts trusted signed packages and labels development manifests untrusted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atlas-interpreters-")),
      signed = path.join(root, "signed"),
      dev = path.join(root, "dev");
    await mkdir(path.join(signed, "package"), { recursive: true });
    await mkdir(dev);
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const { privateKey, publicKey } = generateKeyPairSync("ed25519"),
      manifest = {
        ...workloadInterpreter,
        id: "community.postgres",
        publisher: "community",
      },
      signature = sign(
        null,
        interpreterSigningPayload(manifest),
        privateKey,
      ).toString("base64");
    await writeFile(
      path.join(signed, "package", "interpreter.json"),
      JSON.stringify({ manifest, signature }),
    );
    await writeFile(
      path.join(dev, "local.json"),
      JSON.stringify({ ...workloadInterpreter, id: "local.experimental" }),
    );
    const loaded = await loadInterpreterRegistry({
      signedDir: signed,
      devDir: dev,
      trust: {
        community: publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
      },
    });
    expect(loaded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({ id: "community.postgres" }),
          trusted: true,
          source: "signed",
        }),
        expect.objectContaining({
          manifest: expect.objectContaining({ id: "local.experimental" }),
          trusted: false,
          source: "development",
        }),
      ]),
    );
  });

  it("does not load unsigned development packages in production", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atlas-interpreters-"));
    await writeFile(
      path.join(root, "local.json"),
      JSON.stringify({ ...workloadInterpreter, id: "local.experimental" }),
    );
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    expect(
      await loadInterpreterRegistry({ production: true, devDir: root }),
    ).toEqual([]);
  });

  it("rejects undeclared outputs and unbounded presentation descriptors", () => {
    expect(
      validateInterpreterManifest({
        ...workloadInterpreter,
        stage: "enrich",
        outputKinds: ["capability"],
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("undeclared output kind workload"),
      ]),
    });
    expect(
      validateInterpreterManifest({
        ...workloadInterpreter,
        stage: "present",
        views: [
          {
            id: "oversized",
            title: "Oversized",
            appliesTo: ["workload"],
            sections: Array.from({ length: 21 }, () => ({
              kind: "properties" as const,
            })),
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("at most 20 sections"),
      ]),
    });
  });
});
