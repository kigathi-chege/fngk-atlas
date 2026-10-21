import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// A signed-out machine (fake fngk in "onboarding" mode, see playwright.config.ts).
// Approval in the browser is simulated by the "approved"/"denied" state files.
const baseURL = process.env.ATLAS_E2E_ONBOARDING_URL ?? "http://127.0.0.1:4319";
const state = `/tmp/fngk-atlas-onboarding-state-${new URL(baseURL).port}`;
test.use({ baseURL });
test.beforeEach(async ({ page }) => {
  await rm(state, { recursive: true, force: true });
  await mkdir(state, { recursive: true });
  // The fixture's sign-in link points at a Signal that does not exist here.
  await page.context().route("http://signal.localhost/**", route => route.fulfill({ contentType: "text/html", body: "<title>Signal</title><h1>Signal consent (fixture)</h1>" }));
});

test("signs in to Signal, adds this Device, starts the daemon, and returns to the workbench", async ({ page }) => {
  await page.goto("/");
  const setup = page.getByRole("complementary", { name: "FNGK setup" });
  await expect(setup.getByRole("heading", { name: "Sign in to Signal" })).toBeVisible();
  // No Signal address prompt: the default is used unless the user opens the advanced option.
  await expect(setup.getByLabel("Self-hosted Signal address")).toBeHidden();
  await expect(setup.getByText("Advanced: use a self-hosted Signal")).toBeVisible();

  const popup = page.waitForEvent("popup");
  await setup.getByRole("button", { name: "Sign in to Signal" }).click();
  await expect((await popup).url()).toBe("http://signal.localhost/cli-authorize?code=A1B2C3D4E5F6");
  await expect(setup.getByRole("heading", { name: "Approve in your browser" })).toBeVisible();
  await expect(setup.getByLabel("Sign-in code")).toContainText("A1B2C3D4E5F6");
  await expect(setup.getByLabel("Sign-in link")).toHaveValue("http://signal.localhost/cli-authorize?code=A1B2C3D4E5F6");
  await expect(setup.getByText("Waiting for approval on signal.localhost…")).toBeVisible();
  await expect(setup.getByRole("button", { name: "Open browser again" })).toBeVisible();

  const reloaded = page.waitForEvent("load", { timeout: 15_000 });
  await writeFile(path.join(state, "approved"), "1");
  await expect.poll(() => existsSync(path.join(state, "daemon")), { timeout: 10_000 }).toBe(true);
  // Ready: the page returns to the workbench and the setup panel stays quiet.
  await reloaded;
  await expect(page.locator(".root-dock")).toHaveAttribute("data-layout-ready", "true");
  await expect(page.getByRole("complementary", { name: "FNGK setup" })).toHaveCount(0);
});

test("shows a denied sign-in and lets the user try again or cancel", async ({ page }) => {
  await page.goto("/");
  const setup = page.getByRole("complementary", { name: "FNGK setup" });
  await setup.getByRole("button", { name: "Sign in to Signal" }).click();
  await expect(setup.getByRole("heading", { name: "Approve in your browser" })).toBeVisible();
  await writeFile(path.join(state, "denied"), "1");
  await expect(setup.getByRole("alert")).toHaveText("Sign-in was denied in the browser.");
  await rm(path.join(state, "denied"));
  await setup.getByRole("button", { name: "Sign in to Signal" }).click();
  await expect(setup.getByRole("heading", { name: "Approve in your browser" })).toBeVisible();
  await setup.getByRole("button", { name: "Cancel" }).click();
  await expect(setup.getByRole("heading", { name: "Sign in to Signal" })).toBeVisible();
  expect(existsSync(path.join(state, "signed-in"))).toBe(false);
});

test("uses a self-hosted Signal only from the advanced option", async ({ page }) => {
  await page.goto("/");
  const setup = page.getByRole("complementary", { name: "FNGK setup" });
  await setup.getByText("Advanced: use a self-hosted Signal").click();
  await setup.getByLabel("Self-hosted Signal address").fill("ftp://not-a-signal");
  await setup.getByRole("button", { name: "Sign in to Signal" }).click();
  await expect(setup.getByRole("alert")).toHaveText("Use the HTTPS address of your Signal.");
});

test("installs FNGK when this machine has none, then moves on to sign-in", async ({ page }) => {
  let installed = false, installBody: unknown;
  await page.route("**/api/onboarding/status", async route => {
    const response = await route.fetch(), value = await response.json();
    await route.fulfill({ response, json: installed ? value : { ...value, state: "install-choice" } });
  });
  await page.route("**/api/onboarding/install", async route => { installBody = route.request().postDataJSON(); installed = true; await route.fulfill({ json: { snapshot: {}, events: [] } }); });
  await page.goto("/");
  const setup = page.getByRole("complementary", { name: "FNGK setup" });
  await expect(setup.getByText("signed desktop installer")).toHaveCount(0);
  await setup.getByRole("button", { name: "Install FNGK" }).click();
  expect(installBody).toEqual({ scope: "user", confirm: true });
  await expect(setup.getByRole("button", { name: "Sign in to Signal" })).toBeVisible();
});
