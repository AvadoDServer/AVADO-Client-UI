import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MODE_STORAGE_KEY } from "../../../settings/ModeProvider";
import App from "../App";
import { renderPage } from "../pages/__tests__/renderPage";

const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });
const strip = () => screen.getByRole("region", { name: "Node status" });

describe("Qtum app", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  it("renders the shared shell on the demo node under VITE_MOCK=1, routing by hash, with no network calls", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.location.hash = "#/nope";
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Go to Qtum Staking" }));
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(within(sidebar()).getAllByText("Qtum Staking").length).toBeGreaterThan(0);
    expect(document.title).toBe("AVADO Qtum Staking");
    expect(within(strip()).getByText("Demo data")).toBeInTheDocument();
    expect(await within(strip()).findByText("Running", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The shared sidebar footer: the way back to the Admin and the theme switch.
    expect(within(sidebar()).getByRole("link", { name: "My AVADO" })).toHaveAttribute("href", "http://my.ava.do");
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("lists Home, Wallet and Settings in Simple mode", async () => {
    renderPage("/");
    await within(strip()).findByText("Running");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Wallet", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("adds Advanced in Advanced mode, and every page opens from the sidebar", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderPage("/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Wallet", "Settings", "Advanced"]);
    for (const name of ["Wallet", "Settings", "Advanced", "Home"]) {
      await userEvent.click(within(nav).getByRole("link", { name }));
      expect(screen.getByRole("heading", { level: 1, name })).toBeInTheDocument();
    }
  });

  it("the status strip: running node with block height, peers and the Qtum version; no banners", async () => {
    renderPage("/");
    expect(await within(strip()).findByText("Running")).toBeInTheDocument();
    expect(within(strip()).getByText("4,812,377")).toBeInTheDocument();
    expect(within(strip()).getByText("12")).toBeInTheDocument();
    expect(within(strip()).getByText("Qtum 30.2.0")).toBeInTheDocument();
    expect(within(strip()).queryByText("Demo data")).not.toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(screen.queryByRole("region", { name: "Problems" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Wallet status" })).not.toBeInTheDocument();
  });

  it("the status strip while syncing: the percentage and how far the node has to go", async () => {
    renderPage("/", { scenario: "syncing" });
    expect(await within(strip()).findByText("Syncing 47.18%")).toBeInTheDocument();
    expect(within(strip()).getByText("2,310,552 of 4,812,377")).toBeInTheDocument();
  });

  it("the status strip while the node starts", async () => {
    renderPage("/", { scenario: "fresh" });
    expect(await within(strip()).findByText("Starting")).toBeInTheDocument();
    expect(within(strip()).getByTestId("node-hint")).toHaveTextContent("The Qtum node is starting. This can take a few minutes.");
  });

  it("the status strip when the monitor says the node is stopped", async () => {
    renderPage("/", { node: { rpc: "down" }, walletStatus: { state: "stopped" } });
    expect(await within(strip()).findByText("Stopped")).toBeInTheDocument();
    expect(within(strip()).getByTestId("node-hint")).toHaveTextContent("Restart it in Settings");
  });

  it("says when the package does not answer, after two failed reads", async () => {
    renderPage("/", { backendDown: true });
    const problems = await screen.findByRole("region", { name: "Problems" }, { timeout: 8000 });
    expect(within(problems).getByText("The Qtum package is not answering")).toBeInTheDocument();
    expect(within(problems).getByRole("link", { name: "Open the package" })).toHaveAttribute("href", "http://my.ava.do/#/packages/qtum.avado.dnp.dappnode.eth");
    expect(within(strip()).getByText("Can't connect")).toBeInTheDocument();
  }, 12_000);

  it("opens the menu as a drawer from the top bar and closes it with Escape", async () => {
    renderPage("/");
    await within(strip()).findByText("Running");
    const open = screen.getByRole("button", { name: "Open menu" });
    await userEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });
});
