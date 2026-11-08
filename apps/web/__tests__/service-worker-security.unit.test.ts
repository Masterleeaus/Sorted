import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const workerSource = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8",
);

function createWorkerHarness() {
  const listeners = new Map<string, (event: any) => void>();
  const notifications: Array<{ title: string; options: any }> = [];
  const existingClient = {
    focus: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
  };
  const openWindow = vi.fn(() => Promise.resolve());
  const self = {
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(async () => [existingClient]),
      openWindow,
    },
    registration: {
      showNotification: vi.fn(async (title: string, options: any) => {
        notifications.push({ title, options });
      }),
    },
  };
  runInNewContext(workerSource, { self, fetch: vi.fn() }, { filename: "sw.js" });
  async function push(payload: unknown) {
    let pending: Promise<unknown> | undefined;
    listeners.get("push")!({
      data: { json: () => payload },
      waitUntil: (p: Promise<unknown>) => { pending = p; },
    });
    await pending;
    return notifications.at(-1)!;
  }
  async function click(url: unknown) {
    let pending: Promise<unknown> | undefined;
    listeners.get("notificationclick")!({
      notification: {
        data: { url },
        close: vi.fn(),
      },
      waitUntil: (p: Promise<unknown>) => { pending = p; },
    });
    await pending;
  }
  return { push, click, existingClient, openWindow, notifications, clients: self.clients };
}

describe("Sorted service worker notification isolation", () => {
  it("preserves a legitimate in-app push route and title", async () => {
    const worker = createWorkerHarness();
    const notice = await worker.push({
      title: "Job update", body: "Ready", data: { url: "/app/jobs/123" },
    });
    expect(notice.title).toBe("Job update");
    expect(notice.options.data.url).toBe("/app/jobs/123");
    await worker.click(notice.options.data.url);
    expect(worker.existingClient.navigate).toHaveBeenCalledWith("/app/jobs/123");
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("blocks protocol-relative and backslash redirects when showing and opening notifications", async () => {
    const worker = createWorkerHarness();
    const unsafe = ["//attacker.example/path", "/\\attacker.example/path", "/app\\escape", "/app\nredirect"];
    for (const route of unsafe) {
      const notice = await worker.push({ title: "Notice", data: { url: route } });
      expect(notice.options.data.url).toBe("/");
      await worker.click(route); // A legacy sender may have stored this value already.
      expect(worker.existingClient.navigate).toHaveBeenLastCalledWith("/");
    }
  });

  it("falls back safely when a sender supplies null or primitive JSON", async () => {
    const worker = createWorkerHarness();
    for (const value of [null, 42, true, "hello", []]) {
      const notice = await worker.push(value);
      expect(notice.title).toBe("Sorted");
      expect(notice.options.data.url).toBe("/");
    }
  });

  it("keeps the notification event alive until navigation and focus complete", async () => {
    const worker = createWorkerHarness();
    let completeNavigation: (() => void) | undefined;
    worker.existingClient.navigate.mockImplementationOnce(
      () => new Promise<void>((resolve) => { completeNavigation = resolve; }),
    );
    let finished = false;
    const pending = worker.click("/app/jobs/456").then(() => { finished = true; });
    await vi.waitFor(() => {
      expect(worker.existingClient.navigate).toHaveBeenCalledWith("/app/jobs/456");
    });
    expect(finished).toBe(false);
    expect(worker.existingClient.focus).not.toHaveBeenCalled();
    completeNavigation!();
    await pending;
    expect(worker.existingClient.focus).toHaveBeenCalledOnce();
  });

  it("opens a safe window if all existing client navigations fail", async () => {
    const worker = createWorkerHarness();
    worker.existingClient.navigate.mockRejectedValueOnce(new Error("closed tab"));
    await worker.click("/app/my-work");
    expect(worker.openWindow).toHaveBeenCalledWith("/app/my-work");
    expect(worker.existingClient.focus).not.toHaveBeenCalled();
  });

  it("opens an app window when no existing client is available", async () => {
    const worker = createWorkerHarness();
    worker.clients.matchAll.mockResolvedValueOnce([]);
    await worker.click("//outside.example");
    expect(worker.openWindow).toHaveBeenCalledWith("/");
  });

  it("rejects a malicious legacy notification click even without a prior push event", async () => {
    const worker = createWorkerHarness();
    await worker.click("//external.example");
    expect(worker.existingClient.navigate).toHaveBeenCalledWith("/");
  });
});
