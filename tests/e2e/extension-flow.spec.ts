import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page
} from "@playwright/test";

const extensionPath = resolve("dist");
const httpFixture = "http://localhost:4173/playwright-crx-fixture.html";
const secondHttpFixture =
  "http://127.0.0.1:4173/playwright-crx-fixture.html";
const httpsFixture = "https://localhost:4174/playwright-crx-fixture.html";
const runtimeMessageType = "automation/runtime";

interface ExtensionEnvironment {
  readonly context: BrowserContext;
  readonly extensionId: string;
  readonly panel: Page;
  readonly fixture: Page;
}

const test = base.extend<{ environment: ExtensionEnvironment }>({
  environment: async ({}, use, testInfo) => {
    const userDataDir = testInfo.outputPath("chromium-profile");
    await mkdir(userDataDir, { recursive: true });

    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      ignoreHTTPSErrors: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;

    const fixture = await context.newPage();
    await fixture.goto(httpFixture);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/index.html`);
    await fixture.bringToFront();

    await expect(panel.getByRole("heading", { name: "Current site" })).toBeVisible();
    await expect(panel.getByText("localhost", { exact: true }).first()).toBeVisible();

    await use({ context, extensionId, fixture, panel });
    await context.close();
  }
});

test.describe("unpacked extension release flows", () => {
  test("loads HTTP and HTTPS fixtures, then completes Create -> Save -> Run", async ({
    environment
  }) => {
    const { fixture, panel } = environment;

    await fixture.goto(httpsFixture);
    await fixture.bringToFront();
    await expect(panel.getByText("HTTPS", { exact: true }).first()).toBeVisible();

    await fixture.goto(httpFixture);
    await fixture.bringToFront();
    await expect(panel.getByText("HTTP", { exact: true }).first()).toBeVisible();

    await openView(panel, "Presets and editor");
    await panel.getByRole("button", { name: "New preset" }).click();
    const editor = panel.locator(".preset-editor");
    await editor
      .locator(".editor-section--metadata input")
      .first()
      .fill("E2E create and run");
    await editor.getByLabel("New step type").selectOption("customCode");
    await editor.getByRole("button", { name: "Add step" }).click();
    await editor.getByLabel("JavaScript").fill(
      "document.body.dataset.e2eCreateRun = 'done'; automation.log('E2E create run'); return { state: 'done' };"
    );
    await editor.getByRole("button", { name: "Create preset" }).click();

    await expect(
      panel.getByRole("button", { name: /E2E create and run localhost/ })
    ).toBeVisible();
    await openView(panel, "Dashboard");
    await expect(
      panel.getByLabel("Assigned preset").getByText("E2E create and run")
    ).toBeVisible();
    await panel.getByRole("button", { name: "Run", exact: true }).click();

    await expect
      .poll(() => fixture.getAttribute("body", "data-e2e-create-run"))
      .toBe("done");
    await openView(panel, "Run log");
    await expect(panel.getByText(/Step #1 .* succeeded/)).toBeVisible();
    await expect(panel.getByText("Custom code", { exact: true })).toBeVisible();
  });

  test("completes Record -> reload -> HTML modal -> Edit -> Save -> Run", async ({
    environment
  }) => {
    const { fixture, panel } = environment;
    await fixture.goto(secondHttpFixture);
    await fixture.bringToFront();
    await expect(panel.getByText("127.0.0.1", { exact: true }).first()).toBeVisible();

    await panel.getByRole("button", { name: "Record", exact: true }).click();
    await expect(panel.getByText("Recording", { exact: true }).first()).toBeVisible();

    await fixture.locator("[data-recorder-main-input]").fill("Before reload");
    await fixture.locator("[data-recorder-action]").click();
    await fixture.reload();
    await waitForRecorderState(panel, "recording");

    await fixture.locator("[data-recorder-main-input]").fill("After reload E2E");
    await fixture.locator("[data-recorder-action]").click();
    await fixture.locator("[data-spike-open-modal]").click();
    await expect(fixture.getByRole("dialog", { name: "HTML modal" })).toBeVisible();
    await fixture.locator("[data-spike-modal-input]").fill("Modal E2E value");
    await fixture.locator("[data-spike-close-modal]").click();

    await panel.getByRole("button", { name: "Stop recording" }).click();
    await expect(panel.getByRole("heading", { name: "Review recorded steps" })).toBeVisible();
    const firstStep = panel.locator(".recorded-step-card").first();
    await firstStep.getByLabel("Step name").fill("Edited E2E recorded step");
    await panel.getByRole("button", { name: "Save draft" }).click();
    await expect(panel.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await panel.getByRole("button", { name: "Create preset" }).click();

    await expect
      .poll(async () =>
        (await presetList(panel)).some((preset) =>
          preset.name.startsWith("Recorded automation for 127.0.0.1")
        )
      )
      .toBe(true);
    await openView(panel, "Dashboard");
    await expect(panel.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Run", exact: true }).click();

    await expect(fixture.locator("[data-recorder-main-input]")).toHaveValue(
      "After reload E2E"
    );
    await expect(fixture.locator("[data-recorder-action-count]")).toHaveText("1");
    await expect(fixture.locator("[data-spike-modal]")).toBeHidden();

    await openView(panel, "Run log");
    await expect(panel.getByText("Recorder · Reload", { exact: true })).toBeVisible();
    await expect(panel.getByText(/succeeded/).first()).toBeVisible();
  });

  test("covers repeat, Stop, Stop All and two independent tabs", async ({
    environment
  }) => {
    const { context, fixture, panel } = environment;
    const secondTab = await context.newPage();
    await secondTab.goto(secondHttpFixture);

    const firstTabId = await tabIdFor(panel, fixture);
    const secondTabId = await tabIdFor(panel, secondTab);

    await sendRuntime(panel, {
      type: runtimeMessageType,
      action: "create-preset",
      fields: presetFields("E2E repeat", "localhost", true, [
        waitStep("repeat-pass", 25)
      ])
    });
    await sendRuntime(panel, {
      type: runtimeMessageType,
      action: "run",
      tabId: firstTabId
    });

    await fixture.bringToFront();
    await panel.reload();
    await fixture.bringToFront();
    await expect(panel.getByText("Waiting", { exact: true }).first()).toBeVisible();
    await expect(panel.getByText("Next run", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Stop", exact: true }).click();
    await expect
      .poll(async () => (await repeatStatuses(panel)).length)
      .toBe(0);

    const presets = await presetList(panel);
    const repeatPreset = presets.find((preset) => preset.name === "E2E repeat");
    expect(repeatPreset).toBeDefined();
    await sendRuntime(panel, {
      type: runtimeMessageType,
      action: "delete-preset",
      presetId: repeatPreset!.id
    });

    await sendRuntime(panel, {
      type: runtimeMessageType,
      action: "create-preset",
      fields: presetFields("E2E slow localhost", "localhost", false, [
        waitStep("keep-first-running", 30_000)
      ])
    });
    await sendRuntime(panel, {
      type: runtimeMessageType,
      action: "create-preset",
      fields: presetFields("E2E slow loopback", "127.0.0.1", false, [
        waitStep("keep-second-running", 30_000)
      ])
    });

    await startRunWithoutWaiting(panel, firstTabId);
    await startRunWithoutWaiting(panel, secondTabId);
    await expect.poll(async () => (await sessions(panel)).length).toBe(2);

    await fixture.bringToFront();
    await panel.reload();
    await fixture.bringToFront();
    await expect(panel.getByText("2 active", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Stop All" }).click();
    await panel
      .getByRole("dialog", { name: "Stop all automations?" })
      .getByRole("button", { name: "Stop all automations" })
      .click();

    await expect.poll(async () => (await sessions(panel)).length).toBe(0);
    await expect(panel.getByText("No automations are running.")).toBeVisible();
    await expect(fixture).toHaveURL(httpFixture);
    await expect(secondTab).toHaveURL(secondHttpFixture);
  });
});

async function openView(panel: Page, name: string): Promise<void> {
  await panel.getByRole("button", { name }).click();
}

async function waitForRecorderState(panel: Page, state: string): Promise<void> {
  await expect
    .poll(async () => {
      const tabId = await activeTabId(panel);
      const response = await sendRuntime(panel, {
        type: runtimeMessageType,
        action: "recorder-status",
        tabId
      });
      return response.result.status.state;
    })
    .toBe(state);
}

async function activeTabId(panel: Page): Promise<number> {
  return panel.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error("No active browser tab.");
    return tab.id;
  });
}

async function tabIdFor(panel: Page, target: Page): Promise<number> {
  await target.bringToFront();
  return activeTabId(panel);
}

async function sendRuntime(
  panel: Page,
  message: Record<string, unknown>
): Promise<any> {
  const response = await panel.evaluate(
    async (runtimeMessage) => chrome.runtime.sendMessage(runtimeMessage),
    message
  );
  if (response?.ok !== true) {
    throw new Error(response?.error ?? "Extension runtime request failed.");
  }
  return response;
}

async function startRunWithoutWaiting(panel: Page, tabId: number): Promise<void> {
  await panel.evaluate(
    ({ type, id }) => {
      void chrome.runtime.sendMessage({ type, action: "run", tabId: id });
    },
    { type: runtimeMessageType, id: tabId }
  );
}

async function sessions(panel: Page): Promise<any[]> {
  const response = await sendRuntime(panel, {
    type: runtimeMessageType,
    action: "sessions"
  });
  return response.result.sessions;
}

async function repeatStatuses(panel: Page): Promise<any[]> {
  const response = await sendRuntime(panel, {
    type: runtimeMessageType,
    action: "repeat-statuses"
  });
  return response.result.statuses;
}

async function presetList(panel: Page): Promise<any[]> {
  const response = await sendRuntime(panel, {
    type: runtimeMessageType,
    action: "presets"
  });
  return response.result.presets;
}

function presetFields(
  name: string,
  hostname: string,
  repeat: boolean,
  steps: readonly Record<string, unknown>[]
) {
  return {
    name,
    description: "Created by unpacked extension E2E tests.",
    site: { hostname, protocols: ["http"] },
    automation: {
      defaults: {
        timeoutMs: 40_000,
        postActionDelayMs: 0,
        humanInput: { enabled: false, minDelayMs: 0, maxDelayMs: 0 }
      },
      steps
    },
    siteSettings: {
      enabled: true,
      repeat: { enabled: repeat, intervalMinutes: 1 }
    }
  };
}

function waitStep(id: string, durationMs: number) {
  return {
    id,
    type: "wait",
    name: id,
    enabled: true,
    condition: { type: "timeout", durationMs }
  };
}
