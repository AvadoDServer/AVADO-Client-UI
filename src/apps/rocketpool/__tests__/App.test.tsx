import { render, screen, within } from "@testing-library/react";
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

  it("renders the shared shell on the mock API under VITE_MOCK=1, routing by hash", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.location.hash = "#/nope";
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Go to Rocket Pool" }));
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("heading", { level: 1, name: "Rocket Pool" })).toBeInTheDocument();
    expect(within(sidebar()).getAllByText("Rocket Pool").length).toBeGreaterThan(0);
    expect(document.title).toBe("AVADO Rocket Pool");
    const status = screen.getByTestId("backend-status");
    expect(within(status).getByText("Demo data")).toBeInTheDocument();
    expect(await within(status).findByText("Connected", {}, { timeout: 3000 })).toBeInTheDocument();
    // No client-config.json and no calls to the network in the mock.
    expect(fetchSpy).not.toHaveBeenCalled();

    // The shared sidebar footer: the way back to the Admin and the theme switch.
    expect(within(sidebar()).getByRole("link", { name: "My AVADO" })).toHaveAttribute("href", "http://my.ava.do");
    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("lists one page, Rocket Pool, in Simple mode", async () => {
    renderAt();
    await screen.findByText("Connected");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Rocket Pool"]);
    expect(within(nav).getByRole("link", { name: "Rocket Pool" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the same page list in Advanced mode", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderAt();
    await screen.findByText("Connected");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Rocket Pool"]);
    expect(within(sidebar()).getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says when the backend does not answer, without a demo badge on real data", async () => {
    renderAt("/", { backendDown: true });
    const status = screen.getByTestId("backend-status");
    expect(within(status).getByText("Checking")).toBeInTheDocument();
    expect(await within(status).findByText("Not reachable")).toBeInTheDocument();
    expect(within(status).queryByText("Demo data")).not.toBeInTheDocument();
  });

  it("shows no client banners or client status strip", async () => {
    renderAt();
    await screen.findByText("Connected");
    expect(screen.queryByRole("region", { name: "Problems" })).not.toBeInTheDocument();
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
  });

  it("opens the menu as a drawer from the top bar and closes it with Escape", async () => {
    renderAt();
    await screen.findByText("Connected");
    const open = screen.getByRole("button", { name: "Open menu" });
    await userEvent.click(open);
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menu" })).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("answers an unknown address with a way home", () => {
    renderAt("/nope");
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Rocket Pool" })).toHaveAttribute("href", "/");
  });
});
