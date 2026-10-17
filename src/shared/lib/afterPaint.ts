/** Optional work starts after presentation, then yields to pending input. */
export function scheduleAfterPaint(work: () => void): () => void {
  let stopped = false;
  let frame: number | undefined;
  let idle: number | undefined;
  let timer: number | undefined;
  const run = () => {
    if (stopped) return;
    stopped = true;
    work();
  };
  const waitForIdle = () => {
    frame = undefined;
    if (stopped) return;
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout: 1_000 });
    } else timer = window.setTimeout(run, 0);
  };
  // Hidden windows can suspend frames. Their optional maintenance still gets
  // a bounded opportunity to run, without competing with an initial paint.
  if (document.hidden) timer = window.setTimeout(waitForIdle, 250);
  else {
    frame = requestAnimationFrame(() => {
      if (!stopped) frame = requestAnimationFrame(waitForIdle);
    });
  }
  return () => {
    stopped = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined && typeof window.cancelIdleCallback === "function")
      window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
