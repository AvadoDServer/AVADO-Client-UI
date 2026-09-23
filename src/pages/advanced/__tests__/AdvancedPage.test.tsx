import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiProvider } from "../../../api/ApiProvider";
import { createMockApi } from "../../../api/mock";
import type { Api } from "../../../api/types";
import { ClientConfigProvider } from "../../../config/ClientConfigProvider";
import { normalizeClientConfig, type ClientConfig } from "../../../config/clientConfig";
import AdvancedPage from "../AdvancedPage";

function renderPage(api: Api = createMockApi(), config: ClientConfig = normalizeClientConfig({ client: "nimbus" })) {
  return render(
    <ClientConfigProvider config={config}>
      <ApiProvider api={api}>
        <AdvancedPage />
      </ApiProvider>
    </ClientConfigProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdvancedPage — process status", () => {
  it("lists every supervisord process with its plain-language status", async () => {
    renderPage();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4); // header + nimbus, server, wizard (src/api/mock.ts processes())
    expect(within(table).getByText("nimbus")).toBeInTheDocument();
    expect(within(table).getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("shows a message when there are no processes to report", async () => {
    const api = createMockApi();
    vi.spyOn(api.backend, "serviceStatus").mockResolvedValue([]);
    renderPage(api);
    expect(await screen.findByText("No processes reported.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error when the process status fails to load", async () => {
    const api = createMockApi();
    vi.spyOn(api.backend, "serviceStatus").mockRejectedValue(new Error("supervisord unreachable"));
    renderPage(api);
    expect(await screen.findByRole("alert")).toHaveTextContent("supervisord unreachable");
  });
});

describe("AdvancedPage — service actions", () => {
  it("asks for confirmation before stopping, and does nothing on cancel", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const serviceSpy = vi.spyOn(api.backend, "service");
    renderPage(api);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop the service?" });
    expect(serviceSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it("stops the service once the confirmation is accepted, and refreshes the status", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const serviceSpy = vi.spyOn(api.backend, "service");
    renderPage(api);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop the service?" });
    await user.click(within(dialog).getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(serviceSpy).toHaveBeenCalledWith("stop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The mock backend marks the client process STOPPED once state.running is false.
    expect(await screen.findAllByText("Stopped")).not.toHaveLength(0);
  });

  it("starts and restarts immediately, without a confirmation dialog", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const serviceSpy = vi.spyOn(api.backend, "service");
    renderPage(api);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(serviceSpy).toHaveBeenCalledWith("start"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(serviceSpy).toHaveBeenCalledWith("restart"));
  });

  it("shows an error message when a service action fails", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    vi.spyOn(api.backend, "service").mockRejectedValueOnce(new Error("supervisord unreachable"));
    renderPage(api);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Restart" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("supervisord unreachable");
  });

  it("disables the service buttons while an action is in flight", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    let resolveAction: () => void = () => {};
    vi.spyOn(api.backend, "service").mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = () => resolve();
        }),
    );
    renderPage(api);
    await screen.findByRole("table");

    const start = screen.getByRole("button", { name: "Start" });
    const restart = screen.getByRole("button", { name: "Restart" });
    const stop = screen.getByRole("button", { name: "Stop" });
    await user.click(start);
    expect(start).toBeDisabled();
    expect(restart).toBeDisabled();
    expect(stop).toBeDisabled();

    resolveAction();
    await waitFor(() => expect(start).toBeEnabled());
  });
});

describe("AdvancedPage — logs", () => {
  it("shows a placeholder before the first poll resolves", () => {
    const api = createMockApi();
    // Neither call resolves during this test, so no state update happens
    // after the synchronous assertion below (nothing left pending to flush).
    vi.spyOn(api.dappmanager, "logs").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(api.backend, "serviceStatus").mockImplementation(() => new Promise(() => {}));
    renderPage(api);
    expect(screen.getByText("No log output yet.")).toBeInTheDocument();
  });

  it("polls DAPPMANAGER for this package's logs with a bounded tail", async () => {
    const api = createMockApi();
    const logsSpy = vi.spyOn(api.dappmanager, "logs");
    const config = normalizeClientConfig({ client: "nimbus", network: "mainnet", packageName: "nimbus.avado.dnp.dappnode.eth" });
    renderPage(api, config);
    await waitFor(() => expect(logsSpy).toHaveBeenCalledWith("nimbus.avado.dnp.dappnode.eth", 200));
  });

  it("renders ANSI colour codes as styled HTML, with the underlying text HTML-escaped first", async () => {
    const api = createMockApi();
    vi.spyOn(api.dappmanager, "logs").mockResolvedValue("\u001b[32mINF\u001b[0m boot <script>bad()</script> & ok");
    renderPage(api);

    const terminal = await screen.findByLabelText("Live logs");
    await waitFor(() => expect(terminal).toHaveTextContent(/boot/));
    // Escaped, not interpreted: no real <script> element was injected.
    expect(terminal.querySelector("script")).toBeNull();
    expect(terminal.innerHTML).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(terminal.innerHTML).toContain("&amp; ok");
    // Still styled: the ANSI-coloured "INF" tag becomes a coloured span.
    expect(terminal.querySelector('span[style*="color:rgb("]')).not.toBeNull();
  });

  it("shows an error when the logs fail to load", async () => {
    const api = createMockApi();
    vi.spyOn(api.dappmanager, "logs").mockRejectedValue(new Error("dappmanager unreachable"));
    renderPage(api);
    expect(await screen.findByRole("alert")).toHaveTextContent("dappmanager unreachable");
  });
});

describe("AdvancedPage — Admin link", () => {
  it("links to this package's page in the AVADO Admin, in a new tab", async () => {
    const config = normalizeClientConfig({ client: "teku", network: "holesky" });
    renderPage(createMockApi(), config);
    const link = await screen.findByRole("link", { name: "Open in Admin" });
    expect(link).toHaveAttribute("href", `http://my.ava.do/#/packages/${config.packageName}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
