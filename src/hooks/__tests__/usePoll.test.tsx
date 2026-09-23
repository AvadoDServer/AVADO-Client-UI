import { act, renderHook } from "@testing-library/react";
import { backoffDelay, usePoll } from "../usePoll";

let hidden = false;
function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeAll(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});
beforeEach(() => {
  hidden = false;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Let resolved promises and state updates flush. */
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("usePoll", () => {
  it("loads at once, then polls every interval", async () => {
    let n = 0;
    const fn = vi.fn(async () => ++n);
    const { result } = renderHook(() => usePoll(fn, 1000));
    expect(result.current.loading).toBe(true);
    await flush();
    expect(result.current).toMatchObject({ data: 1, error: undefined, loading: false });
    expect(fn).toHaveBeenCalledTimes(1);

    await advance(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(2);
  });

  it("never overlaps: the next poll is scheduled after the previous one finishes", async () => {
    let release: () => void = () => {};
    const fn = vi.fn(() => new Promise<number>((r) => (release = () => r(1))));
    renderHook(() => usePoll(fn, 1000));
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keeps the last data on an error, backs off, and recovers", async () => {
    let fail = false;
    const fn = vi.fn(async () => {
      if (fail) throw new Error("down");
      return "ok";
    });
    const { result } = renderHook(() => usePoll(fn, 1000));
    await flush();
    expect(result.current.data).toBe("ok");

    fail = true;
    await advance(1000); // call 2 fails
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: "ok", loading: false });
    expect((result.current.error as Error).message).toBe("down");

    await advance(1999);
    expect(fn).toHaveBeenCalledTimes(2); // waits 2 s, not 1 s
    await advance(1); // call 3 fails
    expect(fn).toHaveBeenCalledTimes(3);
    await advance(3999);
    expect(fn).toHaveBeenCalledTimes(3); // then 4 s
    fail = false;
    await advance(1); // call 4 succeeds
    expect(fn).toHaveBeenCalledTimes(4);
    expect(result.current).toMatchObject({ data: "ok", error: undefined });

    await advance(1000); // back to the normal interval
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("backoffDelay doubles per failure up to the cap", () => {
    expect(backoffDelay(12_000, 0)).toBe(12_000);
    expect(backoffDelay(12_000, 1)).toBe(24_000);
    expect(backoffDelay(12_000, 2)).toBe(48_000);
    expect(backoffDelay(12_000, 3)).toBe(60_000); // default cap: max(4 × interval, 60 s)
    expect(backoffDelay(12_000, 30)).toBe(60_000);
    expect(backoffDelay(60_000, 5)).toBe(240_000);
    expect(backoffDelay(5_000, 5, 10_000)).toBe(10_000);
  });

  it("backoffDelay with retryMs: the first retry waits retryMs, then doubles up to the cap", () => {
    expect(backoffDelay(60_000, 0, undefined, 10_000)).toBe(60_000);
    expect(backoffDelay(60_000, 1, undefined, 10_000)).toBe(10_000);
    expect(backoffDelay(60_000, 2, undefined, 10_000)).toBe(20_000);
    expect(backoffDelay(60_000, 5, undefined, 10_000)).toBe(160_000);
    expect(backoffDelay(60_000, 6, undefined, 10_000)).toBe(240_000); // default cap
    expect(backoffDelay(60_000, 9, 60_000, 10_000)).toBe(60_000);
  });

  it("retryMs: retries soon after a failure and goes back to the interval after a success", async () => {
    let fail = true;
    const fn = vi.fn(async () => {
      if (fail) throw new Error("starting");
      return 1;
    });
    const { result } = renderHook(() => usePoll(fn, 60_000, { retryMs: 100 }));
    await flush();
    expect(result.current.error).toBeInstanceOf(Error);
    await advance(100);
    expect(fn).toHaveBeenCalledTimes(2);
    fail = false;
    await advance(200);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ data: 1, error: undefined });
    await advance(59_999);
    expect(fn).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it("pauses while the tab is hidden and resumes when it is shown", async () => {
    const fn = vi.fn(async () => 1);
    renderHook(() => usePoll(fn, 1000));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);

    await advance(400);
    setHidden(true);
    await advance(10_000);
    expect(fn).toHaveBeenCalledTimes(1);

    setHidden(false); // overdue: polls at once
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("when shown again before the next poll is due, waits for the rest of the interval", async () => {
    const fn = vi.fn(async () => 1);
    renderHook(() => usePoll(fn, 1000));
    await flush();
    await advance(200);
    setHidden(true);
    await advance(300);
    setHidden(false);
    await advance(499);
    expect(fn).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a tab opened hidden reads once at once, then waits until it is shown", async () => {
    hidden = true;
    let n = 0;
    const fn = vi.fn(async () => ++n);
    const { result } = renderHook(() => usePoll(fn, 1000));
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ data: 1, loading: false });
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    setHidden(false); // a poll came due while hidden: read again at once
    await flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(2);
    await advance(1000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("refresh() polls now and restarts the interval", async () => {
    let n = 0;
    const fn = vi.fn(async () => ++n);
    const { result } = renderHook(() => usePoll(fn, 1000));
    await flush();
    await advance(600);
    await act(() => result.current.refresh());
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(2);
    await advance(999);
    expect(fn).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("refresh() during a poll fetches again after it, so a mutation's result is not lost", async () => {
    const releases: Array<(v: number) => void> = [];
    const fn = vi.fn(() => new Promise<number>((r) => releases.push(r)));
    const { result } = renderHook(() => usePoll(fn, 1000));
    expect(fn).toHaveBeenCalledTimes(1); // poll 1 in flight (started before the mutation)

    let refreshed = false;
    let p1!: Promise<void>, p2!: Promise<void>;
    act(() => {
      p1 = result.current.refresh().then(() => void (refreshed = true));
      p2 = result.current.refresh(); // a second refresh joins the same re-run
    });
    await act(async () => releases[0](1)); // poll 1 ends with pre-mutation data
    expect(fn).toHaveBeenCalledTimes(2); // re-run started at once
    expect(refreshed).toBe(false);
    await act(async () => releases[1](2));
    await act(() => Promise.all([p1, p2]).then(() => undefined));
    expect(refreshed).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(2);
  });

  it("does nothing while disabled, and starts when enabled", async () => {
    const fn = vi.fn(async () => 1);
    const { result, rerender } = renderHook(({ enabled }) => usePoll(fn, 1000, { enabled }), { initialProps: { enabled: false } });
    await advance(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    rerender({ enabled: true });
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a new key clears the old data and loads again", async () => {
    const fn = vi.fn(async (_k: string) => "x");
    const { result, rerender } = renderHook(({ k }) => usePoll(() => fn(k), 1000, { key: k }), { initialProps: { k: "a" } });
    await flush();
    expect(fn).toHaveBeenLastCalledWith("a");
    rerender({ k: "b" });
    expect(result.current).toMatchObject({ data: undefined, loading: true });
    await flush();
    expect(fn).toHaveBeenLastCalledWith("b");
    expect(result.current).toMatchObject({ data: "x", loading: false });
  });

  it("always calls the latest function without restarting the timer", async () => {
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");
    const { result, rerender } = renderHook(({ fn }) => usePoll(fn, 1000), { initialProps: { fn: a } });
    await flush();
    rerender({ fn: b });
    expect(b).not.toHaveBeenCalled();
    await advance(1000);
    expect(b).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe("b");
  });

  it("stops on unmount and ignores a late answer", async () => {
    let release: () => void = () => {};
    const fn = vi.fn(() => new Promise<number>((r) => (release = () => r(1))));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => usePoll(fn, 1000));
    unmount();
    await act(async () => release());
    await advance(5000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
