import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  documentProcessingPending,
  startDocumentPolling,
} from "../../src/document-processing";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("document background processing", () => {
  it.each([
    ["background", "SCANNING", 3, true],
    ["background", "SCAN_UNAVAILABLE", 2, true],
    ["background", "SCAN_UNAVAILABLE", 3, false],
    ["background", "SCAN_PASSED", 1, false],
    ["background", "SCAN_REJECTED", 1, false],
    ["background", "FORMAT_REJECTED", 1, false],
    ["background", "UPLOADING", 0, false],
    ["inline", "SCANNING", 0, false],
  ])("%s %s attempt %i -> pending=%s", (mode, state, attempts, pending) => {
    expect(
      documentProcessingPending({ processing_mode: mode, state, attempts }),
    ).toBe(pending);
  });
  it("polls sequentially and cancels on unmount/context change", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startDocumentPolling(refresh, vi.fn());
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
    const signal = refresh.mock.calls[0][0] as AbortSignal;
    stop();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("does not overlap slow requests", async () => {
    let resolve!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const stop = startDocumentPolling(refresh, vi.fn());
    await vi.advanceTimersByTimeAsync(60000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    resolve();
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("waits while the tab is hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startDocumentPolling(refresh, vi.fn());
    await vi.advanceTimersByTimeAsync(15000);
    expect(refresh).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });
  it.each([401, 403, 404])("stops when access is lost (%s)", async (status) => {
    const refresh = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Access lost"), { status }));
    const onError = vi.fn();
    const stop = startDocumentPolling(refresh, onError);
    await vi.advanceTimersByTimeAsync(60000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });
  it("backs off transient failures", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValue(new Error("Temporarily unavailable"));
    const stop = startDocumentPolling(refresh, vi.fn());
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
