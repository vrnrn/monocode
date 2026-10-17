import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NewThreadBackgroundEffect } from "./features/settings/model/appearance";
import { prepareNewThreadBackgroundEffect } from "./features/settings/model/newThreadBackgroundEffects";

const WORKSPACE_READY = "vorkspace:workspace-ready";
const EFFECT_TIMEOUT_MS = 1500;

export function markBootWorkspaceReady(splash: HTMLElement) {
  splash.dataset.uiReady = "1";
  document.dispatchEvent(new Event(WORKSPACE_READY));
}

function splashEffect(): NewThreadBackgroundEffect {
  try {
    const saved = localStorage.getItem("monocode.newThreadBackgroundEffect");
    if (saved === "ascii" || saved === "halftone" || saved === "scanlines") {
      return saved;
    }
  } catch {
    // Storage may be unavailable during startup.
  }
  // None, Haze, and missing/invalid preferences use Dither on the splash only.
  return "dither";
}

function startBootSplash(splash: HTMLElement, artwork: HTMLImageElement) {
  let revealed = false;
  let revealScheduled = false;

  function reveal() {
    if (revealed) return;
    revealed = true;
    document.removeEventListener(WORKSPACE_READY, revealAfterPaint);
    // Fast boots show the workspace directly, without flashing the artwork.
    if (splash.dataset.uiReady === "1") splash.remove();
    if (isTauri()) void invoke("reveal_launch_window").catch(console.error);
  }

  function revealAfterPaint() {
    if (revealScheduled) return;
    revealScheduled = true;
    // Hidden webviews may suspend frames, so keep a timer fallback.
    const fallback = window.setTimeout(reveal, 100);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.clearTimeout(fallback);
        reveal();
      }),
    );
  }

  document.addEventListener(WORKSPACE_READY, revealAfterPaint);
  if (splash.dataset.uiReady === "1") {
    revealAfterPaint();
    return;
  }

  async function prepareArtwork() {
    const source = artwork.src;
    const effect = splashEffect();
    const light = document.documentElement.classList.contains("theme-light");
    let objectUrl: string | undefined;
    let timeout: number | undefined;
    splash.dataset.effect = effect;
    try {
      const blob = await Promise.race([
        prepareNewThreadBackgroundEffect(source, source, effect, light),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => {
            reject(new Error("Splash effect preparation timed out."));
          }, EFFECT_TIMEOUT_MS);
        }),
      ]);
      if (revealed || !splash.isConnected) return;
      objectUrl = URL.createObjectURL(blob);
      artwork.src = objectUrl;
      await artwork.decode();
    } catch {
      if (revealed || !splash.isConnected) return;
      splash.dataset.effect = "none";
      artwork.src = source;
      await artwork.decode().catch(() => {});
    } finally {
      window.clearTimeout(timeout);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
    revealAfterPaint();
  }

  void prepareArtwork();
}

const splash = document.getElementById("boot-splash");
const artwork = splash?.querySelector("img");
if (splash && artwork instanceof HTMLImageElement) {
  startBootSplash(splash, artwork);
}
