import { renderHook } from "@testing-library/react";
import { useVisiblePolling } from "../useVisiblePolling";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("useVisiblePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("calls the callback immediately and then on every interval", () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 5000));
    expect(cb).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(5000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("stops polling once the component unmounts", () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useVisiblePolling(cb, 5000));
    expect(cb).toHaveBeenCalledTimes(1);
    unmount();
    vi.advanceTimersByTime(20000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("skips ticks while the tab is hidden", () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 5000));
    expect(cb).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    vi.advanceTimersByTime(20000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately when the tab becomes visible again", () => {
    const cb = vi.fn();
    renderHook(() => useVisiblePolling(cb, 5000));
    expect(cb).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cb).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("always uses the latest callback, without resetting the interval", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useVisiblePolling(cb, 5000), { initialProps: { cb: first } });
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ cb: second });
    vi.advanceTimersByTime(5000);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
