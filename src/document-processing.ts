/** Background processing is technical validation, never a human review. */
export function documentProcessingPending(version: {
  processing_mode?: string;
  state: string;
  attempts: number;
}): boolean {
  return (
    version.processing_mode === "background" &&
    (version.state === "SCANNING" ||
      (version.state === "SCAN_UNAVAILABLE" && version.attempts < 3))
  );
}

/** Sequential, abortable polling. No requests in a hidden tab; transient-error backoff. */
export function startDocumentPolling(
  refresh: (signal: AbortSignal) => Promise<void>,
  onError: (error: Error) => void,
): () => void {
  const controller = new AbortController();
  let stopped = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout>;
  async function tick() {
    if (stopped) return;
    if (document.visibilityState !== "hidden") {
      try {
        await refresh(controller.signal);
        failures = 0;
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        failures += 1;
        const status = (error as Error & { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) stopped = true;
        onError(error as Error);
      }
    }
    if (!stopped)
      timer = setTimeout(
        tick,
        Math.min(30000, 5000 * 2 ** Math.min(failures, 3)),
      );
  }
  timer = setTimeout(tick, 5000);
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };
}
