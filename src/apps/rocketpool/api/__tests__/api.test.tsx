import { render, screen } from "@testing-library/react";
import { createMockRocketpoolApi } from "../mock";
import { STATUS_PATH, createRealRocketpoolApi } from "../real";
import { RocketpoolApiProvider, createRocketpoolApi, isMock, useRocketpoolApi } from "../RocketpoolApiProvider";

describe("Rocket Pool API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("mock: answers, or not when the backend is down", async () => {
    expect(await createMockRocketpoolApi().ping()).toBe(true);
    expect(await createMockRocketpoolApi({ backendDown: true }).ping()).toBe(false);
  });

  it("real: asks the package backend on the same origin", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await createRealRocketpoolApi(fetchSpy).ping()).toBe(true);
    expect(STATUS_PATH).toBe("/api/avado/status");
    expect(fetchSpy).toHaveBeenCalledWith("/api/avado/status", { headers: { Accept: "application/json" } });
  });

  it("real: an error status or a network failure is 'not reachable', never a throw", async () => {
    expect(await createRealRocketpoolApi(async () => new Response("", { status: 502 })).ping()).toBe(false);
    expect(await createRealRocketpoolApi(async () => Promise.reject(new TypeError("Failed to fetch"))).ping()).toBe(false);
  });

  it("wires the mocks under VITE_MOCK=1, like the client app", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(isMock()).toBe(true);
    expect(await createRocketpoolApi().ping()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without mocks, wires the real adapters", async () => {
    vi.stubEnv("VITE_MOCK", "");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(isMock()).toBe(false);
    expect(await createRocketpoolApi().ping()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("/api/avado/status", expect.anything());
  });

  it("provides the given adapters, and refuses use outside the provider", () => {
    const api = createMockRocketpoolApi();
    function Probe() {
      return <span>{useRocketpoolApi() === api ? "same" : "different"}</span>;
    }
    render(
      <RocketpoolApiProvider api={api}>
        <Probe />
      </RocketpoolApiProvider>,
    );
    expect(screen.getByText("same")).toBeInTheDocument();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useRocketpoolApi() must be used inside <RocketpoolApiProvider>");
    spy.mockRestore();
  });
});
