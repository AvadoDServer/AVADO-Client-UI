import { render, screen } from "@testing-library/react";
import { ClientConfigProvider } from "../../config/ClientConfigProvider";
import { normalizeClientConfig } from "../../config/clientConfig";
import { ApiProvider, createApi, useApi } from "../ApiProvider";
import { createMockApi } from "../mock";

describe("ApiProvider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("provides the given adapters", async () => {
    const api = createMockApi();
    function Probe() {
      return <span>{useApi() === api ? "same" : "different"}</span>;
    }
    render(
      <ClientConfigProvider config={normalizeClientConfig({})}>
        <ApiProvider api={api}>
          <Probe />
        </ApiProvider>
      </ClientConfigProvider>,
    );
    expect(screen.getByText("same")).toBeInTheDocument();
  });

  it("wires the mocks under VITE_MOCK=1", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const api = createApi(normalizeClientConfig({}));
    expect((await api.keymanager.listKeystores()).length).toBeGreaterThan(0);
  });

  it("without mocks, wires the real adapters to the config's apiUrl", async () => {
    vi.stubEnv("VITE_MOCK", "");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ network: "holesky" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const api = createApi(normalizeClientConfig({ client: "teku", network: "holesky" }));
      expect(await api.backend.getSettings()).toEqual({ network: "holesky" });
      expect(fetchSpy).toHaveBeenCalledWith("http://teku-holesky.my.ava.do:9999/settings", expect.anything());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the real adapters are not thenable, so awaiting them doesn't hang", async () => {
    vi.stubEnv("VITE_MOCK", "");
    const api = createApi(normalizeClientConfig({}));
    await expect(Promise.resolve(api.keymanager)).resolves.toBe(api.keymanager);
    expect(await api.beacon).toBe(api.beacon);
  });
});
