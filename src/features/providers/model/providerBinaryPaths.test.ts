import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import {
  loadProviderBinaryPath,
  saveProviderBinaryPath,
} from "./providerBinaryPaths";

const key = "monocode.providerBinaryPaths.v1";

beforeEach(() => {
  mocks.invoke.mockReset();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider binary paths", () => {
  it("repairs malformed storage when saving a path", () => {
    let stored = "not json";
    vi.mocked(localStorage.getItem).mockImplementation(() => stored);
    vi.mocked(localStorage.setItem).mockImplementation((_key, value) => {
      stored = value;
    });
    expect(saveProviderBinaryPath("codex", "/opt/codex")).toBe(true);
    expect(loadProviderBinaryPath("codex")).toBe("/opt/codex");
  });

  it("filters non-string paths before runtime initialization", async () => {
    const stored = JSON.stringify({ cursor: null, codex: "/opt/codex" });
    vi.mocked(localStorage.getItem).mockImplementation(() => stored);
    mocks.invoke.mockResolvedValue({ codex: "/opt/codex" });

    vi.resetModules();
    const providerPaths = await import("./providerBinaryPaths");
    await providerPaths.initializeProviderBinaryPaths();

    expect(mocks.invoke).toHaveBeenCalledWith("harness_runtime_binary_paths", {
      paths: { codex: "/opt/codex" },
    });
    expect(providerPaths.runtimeProviderBinaryPath("pi")).toBeNull();
    expect(providerPaths.runtimeProviderBinaryPath("codex")).toBe("/opt/codex");
  });

  it("keeps the active path unchanged across windows until restart", async () => {
    let stored = JSON.stringify({ pi: "/opt/pi/old" });
    vi.mocked(localStorage.getItem).mockImplementation(() => stored);
    vi.mocked(localStorage.setItem).mockImplementation((_key, value) => {
      stored = value;
    });
    mocks.invoke.mockResolvedValue({ pi: "/opt/pi/old" });

    vi.resetModules();
    const firstWindow = await import("./providerBinaryPaths");
    await firstWindow.initializeProviderBinaryPaths();
    expect(firstWindow.runtimeProviderBinaryPath("pi")).toBe("/opt/pi/old");

    firstWindow.saveProviderBinaryPath("pi", "/opt/pi/new");
    expect(firstWindow.runtimeProviderBinaryPath("pi")).toBe("/opt/pi/old");
    expect(firstWindow.providerBinaryPathChangePending("pi")).toBe(true);

    vi.resetModules();
    const secondWindow = await import("./providerBinaryPaths");
    await secondWindow.initializeProviderBinaryPaths();
    expect(secondWindow.runtimeProviderBinaryPath("pi")).toBe("/opt/pi/old");
    expect(secondWindow.providerBinaryPathChangePending("pi")).toBe(true);

    mocks.invoke.mockResolvedValue({ pi: "/opt/pi/new" });
    vi.resetModules();
    const restartedWindow = await import("./providerBinaryPaths");
    await restartedWindow.initializeProviderBinaryPaths();
    expect(restartedWindow.runtimeProviderBinaryPath("pi")).toBe("/opt/pi/new");
    expect(restartedWindow.providerBinaryPathChangePending("pi")).toBe(false);
  });

  it("reports storage failures without claiming the path was saved", () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error("storage full");
    });
    expect(saveProviderBinaryPath("omp", "/opt/opencode")).toBe(false);
  });
  it("does not send removed providers' saved paths to the native runtime", async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(
      JSON.stringify({
        cursor: "/old/cursor-agent",
        devin: "/old/devin",
        pi: "/opt/pi",
        antigravity: "/opt/agy_acp_server.par",
      }),
    );
    mocks.invoke.mockResolvedValue({
      pi: "/opt/pi",
      antigravity: "/opt/agy_acp_server.par",
    });
    vi.resetModules();
    const paths = await import("./providerBinaryPaths");
    await paths.initializeProviderBinaryPaths();
    expect(mocks.invoke).toHaveBeenCalledWith("harness_runtime_binary_paths", {
      paths: { pi: "/opt/pi", antigravity: "/opt/agy_acp_server.par" },
    });
  });
});
