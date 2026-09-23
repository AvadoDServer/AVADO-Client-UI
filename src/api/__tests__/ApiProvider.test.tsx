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

  it("without mocks, calls reject instead of crashing the page (real adapters come in Task 2)", async () => {
    vi.stubEnv("VITE_MOCK", "");
    const api = createApi(normalizeClientConfig({}));
    await expect(api.backend.getSettings()).rejects.toThrow();
  });
});
