import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy UI cutover", () => {
  it("has no legacy graph or superseded explorer loaders", async () => {
    const components = path.resolve("src/web/components"),
      panelHost = await readFile(path.join(components, "PanelHost.svelte"), "utf8"),
      semanticAtlas = await readFile(path.join(components, "SemanticAtlas.svelte"), "utf8");
    expect(panelHost).not.toContain("graph:()=>");
    expect(panelHost).not.toContain("File" + "Explorer");
    expect(semanticAtlas).not.toContain("Machine" + "Overview");
    expect(semanticAtlas).not.toContain("Semantic" + "CardGrid");
    for (const name of [
      "Graph" + "Panel.svelte",
      "File" + "Explorer.svelte",
      "Machine" + "Overview.svelte",
      "Semantic" + "Card.svelte",
      "Semantic" + "CardGrid.svelte",
    ])
      await expect(access(path.join(components, name))).rejects.toThrow();
  });
});
