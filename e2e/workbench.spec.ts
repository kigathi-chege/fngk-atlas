import { expect, test } from "@playwright/test";

test.setTimeout(45_000);
const openWorkbench=async(page:any)=>{await page.goto('/');await expect(page.locator('.dv-dockview')).toBeVisible();await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('atlas.workbench.v6')??'null')?.version)).toBe(6)};

test("orients a first-time user with the Machine Observatory", async ({ page }) => {
  await page.route("**/api/world/projection?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        protocolVersion: "atlas.world.v2",
        contextId: "local",
        rootId: "device:kigathi",
        lens: "overview",
        level: 0,
        nodes: [],
        edges: [],
        aggregates: [],
        breadcrumbs: [{ id: "device:kigathi", label: "kigathi", kind: "device" }],
        availableViews: ["overview", "runtime", "software", "relationships", "evidence"],
        availableExpansions: [],
        errors: [],
        synthesis: { headline: "kigathi", facts: [], attention: [], counters: {} },
        observatory: {
          identity: { id: "device:kigathi", label: "kigathi", online: true },
          health: "degraded",
          phase: "running",
          summary: "Two primary workloads are running. One item requires attention.",
          measuredAt: "2026-09-20T12:00:00.000Z",
          stale: false,
          regions: [
            { id: "applications", label: "Applications", health: "degraded", collapsedCount: 0, items: [{ id: "workload:web", label: "Web", kind: "workload", health: "healthy", phase: "running", purpose: "Serves HTTP", active: true, stale: false, confidence: .98, facts: [] }, { id: "workload:worker", label: "Failed worker", kind: "workload", health: "critical", phase: "failed", purpose: "Runs background jobs", active: false, stale: false, confidence: .96, facts: [] }] },
            { id: "data", label: "Data", health: "healthy", collapsedCount: 0, items: [{ id: "workload:postgres", label: "PostgreSQL", kind: "workload", health: "healthy", phase: "running", purpose: "Stores application data", active: true, stale: false, confidence: .99, facts: [] }] },
            { id: "infrastructure", label: "Infrastructure", health: "healthy", collapsedCount: 0, items: [] },
            { id: "development", label: "Development", health: "healthy", collapsedCount: 0, items: [] },
            { id: "system", label: "System", health: "unknown", collapsedCount: 180, items: [] },
            { id: "external", label: "External", health: "healthy", collapsedCount: 0, items: [] },
          ],
          flows: [{ id: "flow:web:postgres", sourceId: "workload:web", targetId: "workload:postgres", sourceLabel: "Web", targetLabel: "PostgreSQL", label: "queries", active: true, health: "healthy", confidence: .95, stale: false }],
          attention: [{ id: "health:worker", text: "Failed worker requires immediate attention.", entityIds: ["workload:worker"], severity: "critical", stale: false }],
          history: [{ id: "change:1", entityId: "workload:worker", text: "Failed worker changed.", at: "2026-09-20T11:59:00.000Z", severity: "warning" }],
        },
      }),
    });
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page);
  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.getByRole("heading", { name: "kigathi" })).toBeVisible();
  await expect(page.getByText("Applications", { exact: true })).toBeVisible();
  await expect(page.getByText("Web → PostgreSQL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /failed worker/i }).first()).toBeVisible();
  await expect(page.getByText("180 inactive system services", { exact: true })).toBeVisible();
  await expect(page.locator("[data-observatory-region]" )).toHaveCount(6);
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test("uses only canonical observatory APIs", async ({ page }) => {
  const forbidden: string[] = [];
  await page.route(/\/api\/(?:atlas\/|graph(?:\?|$)|world\/search)/, async (route) => {
    forbidden.push(route.request().url());
    await route.abort();
  });
  await page.route("**/api/world/projection?**", async (route) => {
    const url = new URL(route.request().url()),
      rootId = url.searchParams.get("rootId"),
      lens = url.searchParams.get("lens") ?? "overview",
      workload = { id: "workload:web", contextId: "local", kind: "workload", namespace: "atlas.resolver.v2", label: "Web", aliases: [], attributes: { health: "healthy", phase: "running", purpose: "Serve the application" }, firstObservedAt: "2026-09-20T12:00:00.000Z", lastObservedAt: "2026-09-20T12:00:00.000Z", stale: false },
      nodes = rootId ? [workload, ...(lens === "runtime" ? [{ ...workload, id: "process:web", kind: "process", label: "node", workloadId: workload.id }] : lens === "software" ? [{ ...workload, id: "function:main", kind: "function", label: "main", workloadId: workload.id, attributes: { path: "src/main.ts" } }] : [])] : [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      protocolVersion: "atlas.world.v2", contextId: "local", rootId: rootId ?? "device:kigathi", lens, level: 0, nodes, edges: [], aggregates: [],
      breadcrumbs: rootId ? [{ id: "device:kigathi", label: "kigathi", kind: "device" }, { id: workload.id, label: workload.label, kind: workload.kind }] : [{ id: "device:kigathi", label: "kigathi", kind: "device" }],
      availableViews: ["overview", "runtime", "software", "relationships", "evidence"], availableExpansions: [], errors: [], synthesis: { headline: rootId ? "Web" : "kigathi", facts: [], attention: [], counters: {} },
      observatory: rootId ? undefined : { identity: { id: "device:kigathi", label: "kigathi", online: true }, health: "healthy", phase: "running", summary: "One primary workload is running.", measuredAt: "2026-09-20T12:00:00.000Z", stale: false, regions: [{ id: "applications", label: "Applications", health: "healthy", collapsedCount: 0, items: [{ id: workload.id, label: workload.label, kind: workload.kind, health: "healthy", phase: "running", purpose: "Serve the application", active: true, stale: false, confidence: .98, facts: [] }] }, { id: "data", label: "Data", health: "healthy", collapsedCount: 0, items: [] }, { id: "infrastructure", label: "Infrastructure", health: "healthy", collapsedCount: 0, items: [] }, { id: "development", label: "Development", health: "healthy", collapsedCount: 0, items: [] }, { id: "system", label: "System", health: "healthy", collapsedCount: 0, items: [] }, { id: "external", label: "External", health: "healthy", collapsedCount: 0, items: [] }], flows: [], attention: [], history: [] },
    }) });
  });
  await page.route("**/api/world/entities/**", async (route) => {
    const timeline = route.request().url().includes("/timeline");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(timeline ? { items: [] } : { entity: { id: "workload:web", contextId: "local", kind: "workload", namespace: "atlas.resolver.v2", label: "Web", attributes: { health: "healthy", phase: "running", purpose: "Serve the application" }, stale: false }, assertions: [], relatedEntities: [], views: [{ id: "web.specialist", title: "Web runtime", appliesTo: ["workload"], sections: [{ kind: "properties", title: "Framework", fields: ["purpose"] }] }] }) });
  });
  await page.route("**/api/search?**", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ type: "function", entityId: "function:main", contextId: "local", label: "main", path: "src/main.ts", workloadId: "workload:web", source: "semantic graph" }] }) }));
  await page.route("**/api/state?**", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ index: { id: "index:web", root: "/repo" }, indexes: [{ id: "index:web", root: "/repo" }], runs: [] }) }));
  await page.route("**/api/software/functions?**", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ id: "function:main", label: "main", qualifiedName: "main", path: "src/main.ts", line: 1, complexity: 2, coverage: { fraction: 1, stale: false }, crap: 2, stale: false }] }) }));
  await openWorkbench(page);
  await page.getByRole("button", { name: "Inspect Web" }).click();
  await expect(page.locator(".semantic-details").getByRole("heading", { name: "Web" })).toBeVisible();
  await page.getByRole("button", { name: /Web, healthy, running/ }).click();
  await expect(page.getByRole("heading", { name: "Web" }).first()).toBeVisible();
  await expect(page.getByText("Components & capabilities", { exact: true })).toBeVisible();
  await expect(page.getByText("Web runtime", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Runtime", exact: true }).click();
  await expect(page.getByText("node", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Software", exact: true }).click();
  await expect(page.getByText("main", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Search selected context").fill("main");
  await expect(page.locator(".search-results").getByText("main", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Functions & coverage" }).click();
  await expect(page.locator(".metrics-table").getByText("main", { exact: true })).toBeVisible();
  expect(forbidden).toEqual([]);
});

test("opens on the semantic Device atlas and preserves deep navigation in browser history", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await openWorkbench(page);
  await expect(page.getByRole("tab", { name: "Device Atlas" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Atlas views" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Runtime", exact: true }).click();
  await expect(page).toHaveURL(/atlasView=runtime/);
  await page
    .getByRole("button", { name: "Relationships", exact: true })
    .click();
  await expect(page).toHaveURL(/atlasView=relationships/);
  await expect(page.getByLabel("Contextual relationships")).toBeVisible();
  await expect(page.getByLabel("Relationship list")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/atlasView=runtime/);
  await page.goForward();
  await expect(page).toHaveURL(/atlasView=relationships/);
  expect(errors).toEqual([]);
});

test("renders contextual search and safe filesystem actions in the FNGK Atlas workbench", async ({
  page,
}) => {
  const errors: string[] = [],
    terminalSockets: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    if (socket.url().includes("/api/fngk/terminals"))
      terminalSockets.push(socket.url());
  });
  await openWorkbench(page);
  await expect(
    page.getByText("FNGK Atlas", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".dv-dockview")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "Atlas activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: "Pinned, workspace, and minimized panels",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search" }).first().click();
  await expect(page.getByLabel("Search Atlas")).toBeFocused();
  await expect(page.locator(".context-rail")).toBeVisible();
  await expect(
    page.getByText("Device Atlas", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Functions & coverage", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Filesystem", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".context-rail")
    .getByRole("button", { name: "Atlas process host" })
    .click();
  await expect(
    page.getByRole("button", { name: /package\.json/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /src/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin folder" }).click();
  const pinnedRoot = page.getByRole("button", { name: "Pinned /src" });
  await expect(pinnedRoot).toBeVisible();
  await pinnedRoot.click();
  await expect(page.getByRole("button", { name: /main\.ts/ })).toBeVisible();
  await pinnedRoot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin folder" }).click();
  await expect(pinnedRoot).toHaveCount(0);
  await page.getByRole("button", { name: "Open filesystem" }).click();
  await expect(
    page.getByRole("button", { name: /package\.json/ }),
  ).toBeVisible();
  await page.getByLabel("Search filesystem").fill("package");
  await expect(page.getByText("/package.json", { exact: true })).toBeVisible();
  await page.getByLabel("Search filesystem").fill("");
  const binary = page.locator(".tree-row", { hasText: "binary.dat" });
  await binary.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await page.getByRole("button", { name: "Move to trash" }).click();
  await expect(page.locator(".trash-notice")).toContainText("Restore");
  await page
    .locator(".trash-notice")
    .getByRole("button", { name: "Restore" })
    .click();
  await expect(page.locator(".trash-notice")).toHaveCount(0);
  await page.getByRole("button", { name: /package\.json/ }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("fngk-atlas");
  await expect(page.locator(".cm-gutters")).toBeVisible();
  await page.locator(".cm-content").click();
  await expect(page.locator(".cm-cursor")).toBeVisible();
  const openFilePanels = await page.locator(".file-panel").count();
  await page.keyboard.press("Control+Shift+s");
  await expect(
    page.getByRole("dialog", { name: /Save package\.json as/ }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: /Save package\.json as/ })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(page.locator(".file-panel")).toHaveCount(openFilePanels);
  await page.keyboard.press("Control+Shift+p");
  await page.getByLabel("Command search").fill("save as");
  await page.getByRole("button", { name: "File: Save As" }).click();
  await expect(
    page.getByRole("dialog", { name: /Save package\.json as/ }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: /Save package\.json as/ })
    .getByRole("button", { name: "Cancel" })
    .click();
  await page.keyboard.press("Control+n");
  await expect(
    page.getByText("Untitled-1", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".file-panel:visible .cm-content")
    .fill("export const draft = true;");
  await page.keyboard.press("Control+s");
  const saveAs = page.getByRole("dialog", { name: /Save Untitled-1 as/ });
  await expect(saveAs).toBeVisible();
  await saveAs.getByLabel("Save directory").fill("/");
  await saveAs.getByLabel("Save filename").fill("draft.ts");
  await saveAs.getByRole("button", { name: "Create file" }).click();
  await expect(page.locator(".file-panel:visible header")).toContainText(
    "Saved via direct",
  );
  await expect(
    page.locator(".tree-row", { hasText: "draft.ts" }),
  ).toBeVisible();
  await page.getByTitle("Create file").click();
  const inlineName = page.getByLabel("New file name");
  await expect(inlineName).toBeFocused();
  await inlineName.fill("inline.ts");
  await inlineName.press("Enter");
  await expect(
    page.getByText("inline.ts", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".file-panel:visible .cm-content")
    .fill("export const inline = true;");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".file-panel:visible header")).toContainText(
    "Saved via direct",
  );
  await expect(
    page.locator(".tree-row", { hasText: "inline.ts" }),
  ).toBeVisible();
  await page
    .locator(".context-rail")
    .getByRole("button", { name: /kigathi/ })
    .click();
  await page
    .locator(".context-sidebar")
    .getByRole("button", { name: "Open terminal", exact: true })
    .click();
  await expect(
    page.getByText("Terminal", { exact: true }).first(),
  ).toBeVisible();
  const visibleTerminal = page.locator(".terminal-panel:visible");
  await expect(visibleTerminal.locator("header")).toContainText("Live");
  const sessionRail = visibleTerminal.getByRole("navigation", {
    name: "Terminal sessions",
  });
  await expect(sessionRail).toBeVisible();
  await expect(sessionRail.locator(".session-label").first()).toBeVisible();
  expect(
    await sessionRail.evaluate(
      (element) => getComputedStyle(element).overflowY,
    ),
  ).toBe("auto");
  await expect(
    visibleTerminal.getByRole("button", { name: "New terminal session" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const group = (id: string) =>
        document
          .querySelector(`.atlas-tab[data-panel-id="${id}"]`)
          ?.closest(".dv-groupview");
      return (
        group("atlas.terminal") === group("atlas.metrics") &&
        group("atlas.terminal") === group("atlas.activity")
      );
    }),
  ).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("atlas:open-terminal")),
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("atlas:open-terminal")),
  );
  await expect(page.locator(".terminal-panel")).toHaveCount(1);
  expect(terminalSockets.filter((url) => url.includes("new=1"))).toHaveLength(
    0,
  );
  await visibleTerminal
    .getByRole("button", { name: "New terminal session" })
    .click();
  await expect
    .poll(() => terminalSockets.filter((url) => url.includes("new=1")).length)
    .toBe(1);
  await expect(page.locator(".terminal-panel")).toHaveCount(1);
  const separators = page.locator(".dv-sash");
  expect(await separators.count()).toBeGreaterThan(1);
  await page.reload();
  await expect(page.locator(".dv-dockview")).toHaveCount(1);
  await expect(
    page.getByText("Filesystem", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".context-rail")
    .getByRole("button", { name: "Atlas process host" })
    .click();
  await page.route("**/api/files/search?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        matches: [{ path: "/stale-file.txt", type: "file" }],
      }),
    });
  });
  await page.getByLabel("Search filesystem").fill("stale");
  await page
    .locator(".context-rail")
    .getByRole("button", { name: /kigathi/ })
    .click();
  await page.waitForTimeout(600);
  await expect(page.getByText("/stale-file.txt", { exact: true })).toHaveCount(
    0,
  );
  await page.route("**/api/search?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            entityId: "stale",
            type: "function",
            label: "stale indexed result",
            path: "src/stale.ts",
            contextId: "local",
            repositoryRoot: "/safe-root",
          },
        ],
      }),
    });
  });
  await page
    .locator(".context-rail")
    .getByRole("button", { name: "Atlas process host" })
    .click();
  await page.getByLabel("Search Atlas").fill("stale");
  await page
    .locator(".context-rail")
    .getByRole("button", { name: /kigathi/ })
    .click();
  await page.waitForTimeout(600);
  await expect(
    page.getByText("stale indexed result", { exact: true }),
  ).toHaveCount(0);
  for (let index = 0; index < 20; index++) {
    const close = page.locator(".atlas-file-tab-close:visible").first();
    if (!(await close.count())) break;
    await close.click({ force: true });
  }
  const minimizeFilesystem = page.getByRole("button", {
    name: "Minimize Filesystem",
  });
  if (await minimizeFilesystem.count()) await minimizeFilesystem.click();
  const minimizeAtlas = page.getByRole("button", { name: "Minimize Atlas" });
  if (await minimizeAtlas.count()) await minimizeAtlas.click();
  for (let index = 0; index < 30; index++) {
    const minimize = page
      .locator(
        ".atlas-tab:not(.atlas-workspace-anchor) .atlas-tab-minimize:visible",
      )
      .first();
    if (!(await minimize.count())) break;
    await minimize.click({ force: true });
  }
  await expect(page.getByLabel("Empty workspace")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Atlas activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: "Pinned, workspace, and minimized panels",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open filesystem" }).click();
  await expect(
    page.getByText("Filesystem", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".tree-list")
    .click({ button: "right", position: { x: 240, y: 220 } });
  await expect(
    page.getByRole("menuitem", { name: "Pin current folder" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Add workspace root" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("menuitem", { name: "Pin current folder" }),
  ).toHaveCount(0);
  const filesystemTab = page.getByRole("tab", {
    name: "Filesystem",
    exact: true,
  });
  await filesystemTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Minimize" }).click();
  const restoredFilesystem = page.getByRole("button", {
    name: "Restore Filesystem",
  });
  await expect(restoredFilesystem).toBeVisible();
  await expect(
    restoredFilesystem.locator("xpath=ancestor::nav"),
  ).toHaveAttribute("aria-label", "Pinned, workspace, and minimized panels");
  await restoredFilesystem.click();
  await expect(
    page.getByText("Filesystem", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".tree-explorer")).toBeVisible();
  expect(
    await page.evaluate(
      () => {
        const filesystem = document
          .querySelector(".tree-explorer")
          ?.closest(".dv-groupview");
        const workspace = document
          .querySelector('[aria-label="Empty workspace"]')
          ?.closest(".dv-groupview");
        return Boolean(filesystem && workspace && filesystem !== workspace);
      },
    ),
  ).toBe(true);
  await page
    .getByRole("tab", { name: "Filesystem", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Float" }).click();
  await expect(
    page.locator(".dv-floating-overlay-host .dv-resize-container"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("keeps unsaved buffer bodies memory-only and drops stale restored tabs", async ({
  page,
}) => {
  await openWorkbench(page);
  await page.keyboard.press("Control+n");
  await expect(
    page.getByText("Untitled-1", { exact: true }).first(),
  ).toBeVisible();
  await page
    .locator(".file-panel:visible .cm-content")
    .fill("never-persist-this-buffer-body");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "never-persist-this-buffer-body",
  );
  await page.reload();
  await expect(page.getByText("Untitled-1", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Atlas activity" }),
  ).toBeVisible();
});

test("opens Device database and live-project workbenches without starting privileged actions", async ({
  page,
}) => {
  await openWorkbench(page);
  await page
    .locator(".context-rail")
    .getByRole("button", { name: /kigathi/ })
    .click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: /Start dev run/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: /Open deployment workbench/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator(".context-rail")
    .getByRole("button", { name: /kigathi/ })
    .click();
  const sidebar = page.locator(".context-sidebar");
  await sidebar.getByRole("button", { name: "More actions" }).click();
  await sidebar.getByRole("button", { name: "Dev run" }).click();
  await expect(
    page.getByRole("heading", { name: "Run on selected Device" }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "More actions" }).click();
  await sidebar.getByRole("button", { name: "Databases" }).click();
  await expect(page.locator(".native-database")).toBeVisible();
  await expect(page.getByText("Device PostgreSQL resources")).toBeVisible();
  await expect(page.getByText("DbGate")).toHaveCount(0);
  await page
    .locator(".native-database")
    .click({ button: "right", position: { x: 260, y: 180 } });
  await expect(
    page.getByRole("menuitem", { name: "Open deployment workbench" }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Open deployment workbench" })
    .click();
  await expect(
    page.getByRole("tab", { name: "Deployment journey", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Deployment logs", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What should Atlas deploy?" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Deployment stages" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const group = (selector: string) =>
        document.querySelector(selector)?.closest(".dv-groupview");
      return (
        group('.atlas-tab[data-panel-id$=":journey"]') !==
          group('.atlas-tab[data-panel-id="atlas.operations"]')
      );
    }),
  ).toBe(true);
  await page.keyboard.press("Control+Shift+p");
  await page.getByLabel("Command search").fill("intelligence");
  await page
    .getByRole("button", { name: "Context: Open intelligence" })
    .click();
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector('.atlas-tab[data-panel-id="atlas.intelligence"]')
          ?.closest(".dv-groupview") ===
        document
          .querySelector('.atlas-tab[data-panel-id="atlas.filesystem"]')
          ?.closest(".dv-groupview"),
    ),
  ).toBe(true);
});

test("reopens a retained deployment in its operational stage", async ({ page }) => {
  await page.route("**/api/deployments?**", (route) =>
    route.fulfill({
      json: {
        deployments: [
          { id: "deployment-retained", name: "web", status: "healthy" },
        ],
      },
    }),
  );
  await page.route("**/api/deployments/deployment-retained", (route) =>
    route.fulfill({
      json: {
        version: "fngk.deployment.v2",
        deployment: {
          id: "deployment-retained",
          name: "web",
          status: "healthy",
        },
        plan: { revision: 1, status: "succeeded" },
        phases: [{ phase_id: "publish", state: "succeeded", attempt: 1 }],
        phaseLogs: [],
        releases: [{ number: 1, connection_id: "connection-1" }],
        events: [
          {
            event: "route.published",
            detail: { url: "https://web.example.test" },
          },
        ],
        runtimeRoles: [{ role_id: "web", observed_state: "running" }],
      },
    }),
  );
  await page.route(
    "**/api/deployments/deployment-retained/logs?**",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              phase_id: "activate",
              stream: "stdout",
              body_base64: btoa("server ready\n"),
            },
          ],
          nextCursor: 1,
          hasMore: false,
        },
      }),
  );
  await openWorkbench(page);
  await page
    .locator(".context-rail")
    .getByRole("button", { name: /kigathi/ })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: /Open deployment workbench/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "web is healthy" }),
  ).toBeVisible();
  await expect(page.getByText("server ready")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "https://web.example.test" }),
  ).toBeVisible();
});

test("keeps the persistent shell polished and reachable at desktop and narrow widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page);
  await page
    .locator(".context-rail")
    .getByRole("button", { name: "Atlas process host" })
    .click();
  const unified = page.getByLabel("Search Atlas");
  await expect(unified).toBeVisible();
  await unified.fill("package");
  await expect(
    page.getByRole("listbox", { name: "Unified search results" }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /package\.json/ }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".atlas-shell").click({ position: { x: 400, y: 400 } });
  await page.keyboard.press("Control+k");
  await expect(unified).toBeFocused();
  await page.keyboard.press("Escape");
  const geometry = await page.evaluate(() => {
    const left = document
        .querySelector(".context-sidebar")
        ?.closest(".dv-groupview")
        ?.getBoundingClientRect(),
      right = document
        .querySelector(".tree-explorer")
        ?.closest(".dv-groupview")
        ?.getBoundingClientRect(),
      center = document
        .querySelector(".semantic-atlas")
        ?.closest(".dv-groupview")
        ?.getBoundingClientRect(),
      sash = document.querySelector(".dv-sash"),
      view = document.querySelector(".atlas-dock .dv-view"),
      group = document.querySelector(".atlas-dock .dv-groupview"),
      tab = document.querySelector(".atlas-tab:not(.atlas-workspace-anchor)");
    return {
      left: left?.width ?? 0,
      right: right?.width ?? 0,
      center: center?.width ?? 0,
      grip: sash ? getComputedStyle(sash, "::after").content : "",
      sashBackground: sash ? getComputedStyle(sash).backgroundColor : "",
      viewPadding: view ? getComputedStyle(view).padding : "",
      groupRadius: group ? getComputedStyle(group).borderRadius : "",
      tabPadding: tab ? getComputedStyle(tab).padding : "",
      tabRadius: tab ? getComputedStyle(tab).borderRadius : "",
      tabDivider: getComputedStyle(
        document.querySelector(".dv-tab-divider") ?? document.body,
      ).backgroundColor,
    };
  });
  expect(Math.abs(geometry.left - geometry.right)).toBeLessThanOrEqual(16);
  expect(geometry.center).toBeGreaterThan(geometry.left * 1.5);
  expect(geometry.grip).toContain("•••");
  expect(geometry.sashBackground).toBe("rgba(0, 0, 0, 0)");
  expect(geometry.viewPadding).toBe("0px");
  expect(geometry.groupRadius).toBe("8px");
  expect(geometry.tabPadding).toBe("0px 8px");
  expect(geometry.tabRadius).toBe("6px");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
    ),
  ).toBeLessThanOrEqual(0);
  await page.keyboard.press("Control+Shift+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(page.getByLabel("Command search")).toBeFocused();
  const desktop = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    paletteWidth:
      document.querySelector(".command-palette")?.getBoundingClientRect()
        .width ?? 0,
    palettePosition: getComputedStyle(
      document.querySelector(".palette-backdrop")!,
    ).position,
  }));
  expect(desktop.overflow).toBeLessThanOrEqual(0);
  expect(desktop.paletteWidth).toBeGreaterThanOrEqual(420);
  expect(desktop.palettePosition).toBe("fixed");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 620, height: 760 });
  await expect(
    page.getByRole("navigation", { name: "Atlas activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: "Pinned, workspace, and minimized panels",
    }),
  ).toBeVisible();
  await expect(page.locator(".context-sidebar")).toBeHidden();
  await expect(page.locator(".tree-explorer")).toBeHidden();
  expect(
    await page
      .locator(".semantic-atlas")
      .evaluate(
        (element) =>
          element.closest(".dv-groupview")?.getBoundingClientRect().width ?? 0,
      ),
  ).toBeGreaterThan(300);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("discards the legacy workbench schema and restores a full-height six-pixel canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "atlas.workbench.v2",
      JSON.stringify({
        version: 2,
        layout: { grid: { width: 1200, height: 225 } },
      }),
    ),
  );
  await openWorkbench(page);
  const geometry = await page.evaluate(() => {
    const box = (element: Element | null) => {
      const value = element?.getBoundingClientRect();
      return value
        ? {
            left: value.left,
            right: value.right,
            top: value.top,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          }
        : undefined;
    };
    const group = (selector: string) =>
      box(document.querySelector(selector)?.closest(".dv-groupview") ?? null);
    return {
      workbench: box(document.querySelector(".workbench")),
      navigator: group(".context-sidebar"),
      center: group(".atlas-workspace-anchor"),
      filesystem: group(".tree-explorer"),
      legacy: localStorage.getItem("atlas.workbench.v2"),
      saved: JSON.parse(localStorage.getItem("atlas.workbench.v6") ?? "null"),
    };
  });
  expect(geometry.legacy).toBeNull();
  expect(geometry.saved?.version).toBe(6);
  expect(geometry.navigator!.left - geometry.workbench!.left).toBe(6);
  expect(geometry.workbench!.bottom - geometry.navigator!.bottom).toBe(6);
  expect(geometry.center!.left - geometry.navigator!.right).toBe(6);
  expect(geometry.filesystem!.left - geometry.center!.right).toBe(6);
  expect(geometry.navigator!.height).toBe(geometry.workbench!.height - 12);
});

test("keeps sidebar widths and the center workspace when central tabs close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkbench(page);
  const widths = await page.evaluate(() => ({
    left: document
      .querySelector(".context-sidebar")
      ?.closest(".dv-groupview")
      ?.getBoundingClientRect().width,
    right: document
      .querySelector(".tree-explorer")
      ?.closest(".dv-groupview")
      ?.getBoundingClientRect().width,
  }));
  for (const id of ["atlas.observatory", "atlas.metrics", "atlas.activity"])
    await page
      .locator(`.atlas-tab[data-panel-id="${id}"] .atlas-tab-minimize`)
      .click();
  await expect(page.locator(".workspace-placeholder")).toBeVisible();
  const centerGroup = page
    .locator(".dv-groupview")
    .filter({ has: page.locator(".atlas-workspace-anchor") });
  await expect(
    centerGroup.locator(".dv-tabs-and-actions-container"),
  ).toBeHidden();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("atlas:new-buffer")),
  );
  await expect(
    centerGroup.locator('.atlas-tab[data-panel-id^="buffer:"]'),
  ).toBeVisible();
  const after = await page.evaluate(() => ({
    left: document
      .querySelector(".context-sidebar")
      ?.closest(".dv-groupview")
      ?.getBoundingClientRect().width,
    right: document
      .querySelector(".tree-explorer")
      ?.closest(".dv-groupview")
      ?.getBoundingClientRect().width,
  }));
  expect(after.left).toBe(widths.left);
  expect(after.right).toBe(widths.right);
  await page.getByRole("button", { name: "Minimize Filesystem" }).click();
  await page.getByRole("button", { name: "Restore Filesystem" }).click();
  await expect(page.locator('.tree-explorer')).toBeVisible();
  const restored = await page.evaluate(() => {
    const right = document
        .querySelector(".tree-explorer")
        ?.closest(".dv-groupview")
        ?.getBoundingClientRect(),
      center = document
        .querySelector(".atlas-workspace-anchor")
        ?.closest(".dv-groupview")
        ?.getBoundingClientRect();
    return {
      width: right?.width,
      left: right?.left,
      centerRight: center?.right,
    };
  });
  expect(Math.abs(restored.width! - widths.right!)).toBeLessThanOrEqual(1);
  expect(restored.left).toBeGreaterThan(restored.centerRight!);
});
