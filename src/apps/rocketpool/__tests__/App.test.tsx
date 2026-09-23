import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ROUTER_FUTURE } from "../../../routing/routerFuture";
import { MODE_STORAGE_KEY } from "../../../settings/ModeProvider";
import { createMockRocketpoolApi, type RocketpoolMockOptions } from "../api/mock";
import App, { AppRoutes, Providers } from "../App";

function renderAt(path = "/", mock: RocketpoolMockOptions = {}) {
  return render(
    <Providers api={createMockRocketpoolApi(mock)}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
}

const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });

describe("Rocket Pool app", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("renders the shared shell on the demo node under VITE_MOCK=1, routing by hash", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.location.hash = "#/nope";
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Go to Rocket Pool" }));
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(within(sidebar()).getAllByText("Rocket Pool").length).toBeGreaterThan(0);
    expect(document.title).toBe("AVADO Rocket Pool");
    const status = screen.getByTestId("service-status");
    expect(within(status).getByText("Demo data")).toBeInTheDocument();
    expect(await within(status).findByText("Running", {}, { timeout: 3000 })).toBeInTheDocument();
    // The default demo node (mixed) has two banners.
    const problems = await screen.findByRole("region", { name: "Problems" }, { timeout: 3000 });
    expect(within(problems).getByText("Your recovery phrase is stored in a plain file")).toBeInTheDocument();
    expect(within(problems).getByText("1 validator key needs your approval")).toBeInTheDocument();
    // No calls to the network in the mock.
    expect(fetchSpy).not.toHaveBeenCalled();

    // The shared sidebar footer: the way back to the Admin and the theme switch.
    expect(within(sidebar()).getByRole("link", { name: "My AVADO" })).toHaveAttribute("href", "http://my.ava.do");
    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("lists Home, Validators, Rewards and Wallet in Simple mode", async () => {
    renderAt("/", { scenario: "minipool" });
    await screen.findByText("Running");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Validators", "Rewards", "Wallet"]);
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("adds Advanced in Advanced mode", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderAt("/", { scenario: "minipool" });
    await screen.findByText("Running");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Validators", "Rewards", "Wallet", "Advanced"]);
    expect(within(sidebar()).getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens every page from the sidebar", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderAt("/", { scenario: "minipool" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const name of ["Validators", "Rewards", "Wallet", "Advanced", "Home"]) {
      await userEvent.click(within(nav).getByRole("link", { name }));
      expect(screen.getByRole("heading", { level: 1, name })).toBeInTheDocument();
    }
  });

  it("a healthy minipool node shows no banners", async () => {
    renderAt("/", { scenario: "minipool" });
    await screen.findByText("Running");
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByRole("region", { name: "Problems" })).not.toBeInTheDocument();
  });

  it("a daemon that failed to start: the error with its log lines, and Stopped", async () => {
    renderAt("/", { scenario: "daemon-failed" });
    const problems = await screen.findByRole("region", { name: "Problems" });
    expect(within(problems).getByText("Rocket Pool could not start")).toBeInTheDocument();
    expect(within(problems).getByText(/could not load its settings/)).toBeInTheDocument();
    expect(within(problems).getAllByRole("listitem")).toHaveLength(2);
    expect(within(problems).getByRole("link", { name: "See the logs" })).toHaveAttribute("href", "/advanced");
    expect(within(screen.getByTestId("service-status")).getByText("Stopped")).toBeInTheDocument();
  });

  it("a fresh node is sent to setup", async () => {
    renderAt("/", { scenario: "fresh" });
    const problems = await screen.findByRole("region", { name: "Problems" });
    expect(within(problems).getByText("Set up your node")).toBeInTheDocument();
    await userEvent.click(within(problems).getByRole("link", { name: "Start setup" }));
    expect(screen.getByRole("heading", { level: 1, name: "Set up your node" })).toBeInTheDocument();
  });

  it("says when the package does not answer, without a demo badge on real data", async () => {
    renderAt("/", { backendDown: true });
    const status = screen.getByTestId("service-status");
    expect(within(status).getByText("Checking")).toBeInTheDocument();
    // One failed poll is not enough; the second (3 s later) is.
    expect(await within(status).findByText("Not reachable", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(within(status).queryByText("Demo data")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Problems" })).toHaveTextContent("The Rocket Pool package is not answering");
  });

  it("after a reload, a transaction whose send was cut off shows on every page and links back", async () => {
    localStorage.setItem(
      "avado-rocketpool.pending-tx.v1",
      JSON.stringify([{ key: "node/distribute?[]", title: "Distribute your rewards", route: "node/distribute", params: {}, page: "/rewards", state: "sending", createdAt: 1, updatedAt: 1 }]),
    );
    renderAt("/wallet", { scenario: "minipool" });
    const problems = await screen.findByRole("region", { name: "Problems" });
    expect(within(problems).getByText("Check your transaction: Distribute your rewards")).toBeInTheDocument();
    expect(within(problems).getByRole("link", { name: "Open" })).toHaveAttribute("href", "/rewards");
  });

  it("shows no client status strip", async () => {
    renderAt("/", { scenario: "minipool" });
    await screen.findByText("Running");
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
  });

  it("opens the menu as a drawer from the top bar and closes it with Escape", async () => {
    renderAt();
    await screen.findByText("Running");
    const open = screen.getByRole("button", { name: "Open menu" });
    await userEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("answers an unknown address with a way home, banners included", async () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Rocket Pool" })).toHaveAttribute("href", "/");
    expect(await screen.findByRole("region", { name: "Problems" })).toBeInTheDocument();
  });
});
