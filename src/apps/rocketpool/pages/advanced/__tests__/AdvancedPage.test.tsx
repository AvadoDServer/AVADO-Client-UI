import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../__tests__/renderPage";

describe("Advanced page", () => {
  it("wraps a key-check message with a full pubkey at phone width", async () => {
    renderPage("/advanced", { scenario: "keys-attention" }, { advanced: true });
    const message = await screen.findByTestId("key-check-message", {}, { timeout: 3000 });
    expect(message).toHaveTextContent(/loaded in both Nimbus and Teku/);
    expect(message.className).toContain("[overflow-wrap:anywhere]");
  });

  it("shows the service, versions, automatic actions with their gas limit, and gas for confirmed transactions", async () => {
    renderPage("/advanced", { scenario: "minipool" }, { advanced: true });
    const service = screen.getByTestId("service");
    expect(await within(service).findByText("Running", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(service).getByText("Package version").nextElementSibling).toHaveTextContent("1.0.0");
    expect(await within(service).findByText("1.24.2")).toBeInTheDocument();
    const auto = screen.getByTestId("automatic-actions");
    expect(within(auto).getByText("Keep minipool contracts up to date")).toBeInTheDocument();
    // M5: the owner learns the node may exit a validator by itself when Rocket Pool requires it.
    expect(within(auto).getByText("Exit a validator when Rocket Pool requires it")).toBeInTheDocument();
    expect(within(auto).getByText("Answer challenges")).toBeInTheDocument();
    expect(within(auto).getByText("Gas limit for automatic actions").nextElementSibling).toHaveTextContent("20 gwei");
    expect(within(auto).getByText(/usually well below 20 gwei/)).toBeInTheDocument();
    expect(await within(auto).findByText(/Right now the base fee is 0.85 gwei, below the limit, so automatic actions go ahead./)).toBeInTheDocument();
    expect(within(auto).getByText("These are the package's settings, applied on every start.")).toBeInTheDocument();
    expect(screen.getByText("Tip for the block builder").nextElementSibling).toHaveTextContent("1 gwei");
  });

  it("shows settings the backend reports without the template note", async () => {
    renderPage("/advanced", { scenario: "exits" }, { advanced: true });
    const auto = await screen.findByTestId("automatic-actions");
    await within(screen.getByTestId("service")).findByText("Running", {}, { timeout: 3000 });
    expect(within(auto).queryByText("These are the package's settings, applied on every start.")).toBeNull();
  });

  it("shows the key check and runs it on request", async () => {
    const { posts } = renderPage("/advanced", { scenario: "minipool" }, { advanced: true });
    const check = screen.getByTestId("key-check");
    expect(await within(check).findByText("Validator keys in sync with Nimbus: 2/2.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(check).getByText("Keys loaded").nextElementSibling).toHaveTextContent("2 of 2");
    await userEvent.click(within(check).getByRole("button", { name: "Check now" }));
    expect(await within(check).findByText(/A check was asked for/)).toBeInTheDocument();
    expect(posts()).toEqual([{ method: "POST", path: "/api/avado/reconcile/run", params: {} }]);
  });

  it("shows the logs and how many lines", async () => {
    const { api } = renderPage("/advanced", { scenario: "mixed" }, { advanced: true });
    const logs = screen.getByTestId("logs");
    expect(await within(logs).findByText(/Megapool validator 1 is in the deposit queue/)).toBeInTheDocument();
    await userEvent.selectOptions(within(logs).getByLabelText("Lines to show"), "500");
    await waitFor(() => expect(api.calls.some((c) => c.path === "/api/avado/logs?tail=500")).toBe(true));
  });

  it("works while the daemon is down: the startup error and the logs, no Smartnode reads", async () => {
    const { api } = renderPage("/advanced", { scenario: "daemon-failed" }, { advanced: true });
    const service = screen.getByTestId("service");
    expect(await within(service).findByText(/could not load its settings/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(service).getByText("Smartnode version").nextElementSibling).toHaveTextContent("—");
    expect(await within(screen.getByTestId("logs")).findByText(/execution client not reachable/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.path.startsWith("/api/sn/"))).toBe(false);
  });
});
