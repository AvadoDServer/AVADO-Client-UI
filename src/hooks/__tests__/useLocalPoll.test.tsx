import { act, renderHook, waitFor } from "@testing-library/react";
import { useLocalPoll } from "../useLocalPoll";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useLocalPoll", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("reads now, then every interval", async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useLocalPoll(fn, 1000));
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(fn).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("reads once even when opened in a hidden tab, then pauses, then reads right away when visible", async () => {
    setHidden(true);
    const fn = vi.fn().mockResolvedValue("x");
    const { result } = renderHook(() => useLocalPoll(fn, 1000));
    await waitFor(() => expect(result.current.data).toBe("x"));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => setHidden(false));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it("keeps the last data on an error and reports it", async () => {
    const fn = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useLocalPoll(fn, 1000));
    await waitFor(() => expect(result.current.data).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.data).toBe(1);
  });

  it("refresh() and a new resetKey read again at once", async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const { result, rerender } = renderHook(({ k }) => useLocalPoll(fn, 60_000, k), { initialProps: { k: "a" } });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    rerender({ k: "b" });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(3));
  });

  it("stops on unmount", async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const { unmount } = renderHook(() => useLocalPoll(fn, 1000));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
