import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes, Providers, ROUTER_FUTURE } from "../../../App";
import { createMockApi, MOCK_SETTINGS, type MockOptions } from "../../../api/mock";
import type { Api } from "../../../api/types";
import type { ClientConfig, ClientConfigResult } from "../../../config/clientConfig";
import { MODE_STORAGE_KEY } from "../../../settings/ModeProvider";
import { SETTINGS_SAVED_EVENT } from "../Shell";

const NIMBUS: ClientConfig = {
  client: "nimbus",
  network: "mainnet",
  packageName: "nimbus.avado.dnp.dappnode.eth",
  apiUrl: "http://nimbus.my.ava.do:9999",
  backend: "deno",
  features: { batchImport: true, backup: false, zeroSync: false },
};

function renderApp({
  path = "/",
  mock = {},
  config = NIMBUS,
  configResult,
  api = createMockApi({ latencyMs: 0, ...mock }),
}: { path?: string; mock?: MockOptions; config?: ClientConfig; configResult?: ClientConfigResult; api?: Api } = {}) {
  const utils = render(
    <Providers config={configResult ? undefined : config} configResult={configResult} api={api}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
  return { api, ...utils };
}

const mainNav = () => screen.getByRole("navigation", { name: "Main" });
const navLabels = () => within(mainNav()).getAllByRole("link").map((a) => a.textContent);
const problems = () => screen.queryByRole("region", { name: "Problems" });

describe("Shell navigation", () => {
  it("lists Validators, Add validators and Settings in Simple mode, without Advanced", async () => {
    renderApp();
    expect(navLabels()).toEqual(["Validators", "Add validators", "Settings"]);
    expect(await screen.findByText("Synced")).toBeInTheDocument();
  });

  it("adds Advanced in Advanced mode", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderApp();
    expect(navLabels()).toEqual(["Validators", "Add validators", "Settings", "Advanced"]);
    await screen.findByText("Synced");
  });

  it("the footer's mode switch shows and hides Advanced", async () => {
    const user = userEvent.setup();
    renderApp();
    const mode = screen.getByRole("group", { name: "Mode" });
    await user.click(within(mode).getByRole("button", { name: "Advanced" }));
    expect(within(mode).getByRole("button", { name: "Advanced" })).toHaveAttribute("aria-pressed", "true");
    expect(within(mainNav()).getByRole("link", { name: "Advanced" })).toHaveAttribute("href", "/advanced");
    await user.click(within(mode).getByRole("button", { name: "Simple" }));
    expect(within(mainNav()).queryByRole("link", { name: "Advanced" })).toBeNull();
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe("simple");
  });

  it("the footer's theme switch paints the theme", async () => {
    const user = userEvent.setup();
    renderApp();
    const theme = screen.getByRole("group", { name: "Theme" });
    expect(within(theme).getByRole("button", { name: "Match computer" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(theme).getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.click(within(theme).getByRole("button", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("marks the current page and navigates", async () => {
    const user = userEvent.setup();
    renderApp();
    expect(within(mainNav()).getByRole("link", { name: "Validators" })).toHaveAttribute("aria-current", "page");
    await user.click(within(mainNav()).getByRole("link", { name: "Settings" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(within(mainNav()).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(within(mainNav()).getByRole("link", { name: "Validators" })).not.toHaveAttribute("aria-current");
  });

  it("shows the client identity: logo, name and network", () => {
    renderApp({ config: { ...NIMBUS, network: "holesky" } });
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(sidebar).getByText("Nimbus")).toBeInTheDocument();
    expect(within(sidebar).getByText("Holesky")).toBeInTheDocument();
    expect(sidebar.querySelector("img")?.getAttribute("src")).toMatch(/nimbus-holesky/);
    expect(document.title).toBe("AVADO Nimbus");
  });

  it("links back to the AVADO Admin (My AVADO)", () => {
    renderApp();
    expect(screen.getByRole("link", { name: "My AVADO" })).toHaveAttribute("href", "http://my.ava.do");
  });
});

describe("Routing", () => {
  it.each([
    ["/", "Validators"],
    ["/add", "Add validators"],
    ["/settings", "Settings"],
  ])("%s renders %s", (path, heading) => {
    renderApp({ path });
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("a deep link to /advanced works in Simple mode and says it is an Advanced page", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/advanced" });
    expect(screen.getByRole("heading", { level: 1, name: "Advanced" })).toBeInTheDocument();
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("part of Advanced mode");
    await user.click(within(note).getByRole("button", { name: "Switch to advanced" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(within(mainNav()).getByRole("link", { name: "Advanced" })).toHaveAttribute("aria-current", "page");
  });

  it("no note on /advanced in Advanced mode", () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderApp({ path: "/advanced" });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("an unknown address shows Page not found inside the shell, with a way home", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/nope/really" });
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(mainNav()).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Go to validators" }));
    expect(screen.getByRole("heading", { level: 1, name: "Validators" })).toBeInTheDocument();
  });
});

describe("Status strip", () => {
  const strip = () => screen.getByRole("region", { name: "Node status" });

  it("shows health, peers and version in plain words", async () => {
    renderApp();
    await within(strip()).findByText("Synced");
    expect(strip()).toHaveTextContent("Peers78");
    expect(strip()).toHaveTextContent("VersionNimbus v26.8.0");
    expect(strip()).not.toHaveTextContent("Head slot");
    expect(strip()).not.toHaveTextContent("Inbound");
  });

  it("Advanced adds inbound/outbound peers and the head slot", async () => {
    localStorage.setItem(MODE_STORAGE_KEY, "advanced");
    renderApp();
    await within(strip()).findByText("26 / 52");
    expect(strip()).toHaveTextContent("Head slot12,634,567");
  });

  it("shows the sync percentage while syncing", async () => {
    renderApp({ mock: { health: "syncing", syncing: { head_slot: "9712", sync_distance: "288", is_syncing: true } } });
    expect(await within(strip()).findByText("Syncing 97.12%")).toBeInTheDocument();
  });

  it("says Starting when the process runs but the node is not ready yet", async () => {
    renderApp({ mock: { health: "not_ready" } });
    expect(await within(strip()).findByText("Starting")).toBeInTheDocument();
    expect(strip()).toHaveTextContent("Nimbus is starting. This can take a few minutes.");
    expect(strip()).not.toHaveTextContent("Peers");
  });

  it("says Stopped, with a way to start it, when supervisord reports the client stopped", async () => {
    const api = createMockApi({ latencyMs: 0 });
    await api.backend.service("stop");
    renderApp({ api });
    expect(await within(strip()).findByText("Stopped")).toBeInTheDocument();
    expect(within(strip()).getByRole("link", { name: "Start it in Advanced" })).toHaveAttribute("href", "/advanced");
  });

  it("says Not ready, and both possibilities, when the process state is unknown", async () => {
    const api = createMockApi({ latencyMs: 0, health: "not_ready" });
    vi.spyOn(api.backend, "serviceStatus").mockRejectedValue(new Error("down"));
    renderApp({ api });
    expect(await within(strip()).findByText("Not ready")).toBeInTheDocument();
    expect(strip()).toHaveTextContent("Nimbus is starting, or it is stopped.");
    expect(within(strip()).getByRole("link", { name: "check Advanced" })).toHaveAttribute("href", "/advanced");
  });

  it("the hint sits outside the description list (valid <dl>)", async () => {
    renderApp({ mock: { health: "not_ready" } });
    await within(strip()).findByText("Starting");
    const dl = strip().querySelector("dl")!;
    for (const child of Array.from(dl.children)) expect(child.tagName).toBe("DIV");
    expect(dl).not.toContainElement(screen.getByTestId("not-ready-hint"));
  });

  it("survives a restart during the session: ready, then down, then ready again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = createMockApi({ latencyMs: 0 });
      renderApp({ api });
      await within(strip()).findByText("Synced");
      const health = vi.spyOn(api.beacon, "health").mockRejectedValue(new Error("connection refused"));
      await act(() => vi.advanceTimersByTimeAsync(12_000));
      expect(await within(strip()).findByText("Starting")).toBeInTheDocument();
      expect(strip()).not.toHaveTextContent("Peers");
      health.mockRestore();
      await act(() => vi.advanceTimersByTimeAsync(12_000));
      expect(await within(strip()).findByText("Synced")).toBeInTheDocument();
      expect(strip()).toHaveTextContent("Peers78");
      expect(strip()).toHaveTextContent("VersionNimbus v26.8.0");
    } finally {
      vi.useRealTimers();
    }
  });

  it("polls every 12 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api } = renderApp();
      const health = vi.spyOn(api.beacon, "health");
      await within(strip()).findByText("Synced");
      expect(health).toHaveBeenCalledTimes(0);
      await act(() => vi.advanceTimersByTimeAsync(12_000));
      expect(health).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Problem banners", () => {
  it("shows none on a healthy box", async () => {
    renderApp({ mock: { settings: MOCK_SETTINGS } });
    await screen.findByText("Synced");
    await waitFor(() => expect(problems()).toBeNull());
  });

  it("no fee recipient: links to settings", async () => {
    renderApp({ mock: { settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" } } });
    const link = await screen.findByRole("link", { name: "Set fee recipient" });
    expect(link).toHaveAttribute("href", "/settings?focus=fee-recipient");
    expect(problems()).toHaveTextContent("No fee recipient set");
  });

  it("no execution client installed: links to the DappStore", async () => {
    renderApp({ mock: { settings: MOCK_SETTINGS, packages: ["dappmanager.dnp.dappnode.eth", "nimbus.avado.dnp.dappnode.eth"] } });
    const link = await screen.findByRole("link", { name: "Install an execution client" });
    expect(link).toHaveAttribute("href", "http://my.ava.do/#/installer");
  });

  it("execution client offline: links to its package", async () => {
    renderApp({
      mock: {
        settings: MOCK_SETTINGS,
        syncing: { head_slot: "100", sync_distance: "0", is_syncing: false, el_offline: true },
      },
    });
    const link = await screen.findByRole("link", { name: "Open Geth" });
    expect(link).toHaveAttribute("href", "http://my.ava.do/#/packages/ethchain-geth.public.dappnode.eth");
  });

  it("an installed but stopped execution client (listPackageStates) is stopped, not missing", async () => {
    const api = createMockApi({ latencyMs: 0, settings: MOCK_SETTINGS });
    Object.assign(api.dappmanager, {
      listPackageStates: vi.fn().mockResolvedValue([
        { name: "nimbus.avado.dnp.dappnode.eth", running: true },
        { name: "ethchain-geth.public.dappnode.eth", running: false },
      ]),
    });
    renderApp({ api });
    expect(await screen.findByText("Geth is stopped")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Geth" })).toHaveAttribute(
      "href",
      "http://my.ava.do/#/packages/ethchain-geth.public.dappnode.eth",
    );
    expect(screen.queryByText("No execution client installed")).toBeNull();
  });

  it("keeps the last known banners while the backend and DAPPMANAGER can't be read (restart)", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ mock: { settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" }, packages: [] } });
    await screen.findByText("No fee recipient set");
    await screen.findByText("No execution client installed");
    const get = vi.spyOn(api.backend, "getSettings").mockRejectedValue(new Error("restarting"));
    const list = vi.spyOn(api.dappmanager, "listPackages").mockRejectedValue(new Error("wamp down"));
    await user.click(within(mainNav()).getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByText("No fee recipient set")).toBeInTheDocument();
    expect(screen.getByText("No execution client installed")).toBeInTheDocument();
  });

  it("testnet notice on Holesky", async () => {
    renderApp({
      config: { ...NIMBUS, network: "holesky", packageName: "nimbus-holesky.avado.dnp.dappnode.eth" },
      mock: {
        settings: { ...MOCK_SETTINGS, network: "holesky", execution_engine: "holesky-geth.avado.dnp.dappnode.eth" },
        packages: ["holesky-geth.avado.dnp.dappnode.eth"],
      },
    });
    expect(await screen.findByText("Holesky test network")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find the mainnet version" })).toHaveAttribute("href", "http://my.ava.do/#/installer");
    expect(problems()!.querySelectorAll("[data-problem]")).toHaveLength(1);
  });

  it("wrong configuration from the config loader, with the details", async () => {
    renderApp({
      configResult: { config: NIMBUS, source: "hostname", problems: ["client-config.json is missing (HTTP 404)"] },
      mock: { settings: MOCK_SETTINGS },
    });
    expect(await screen.findByText("Wrong configuration")).toBeInTheDocument();
    expect(screen.getByText("client-config.json is missing (HTTP 404)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the package" })).toHaveAttribute(
      "href",
      "http://my.ava.do/#/packages/nimbus.avado.dnp.dappnode.eth",
    );
  });

  it("unknown network in the settings", async () => {
    renderApp({ mock: { settings: { ...MOCK_SETTINGS, network: "sepolia" } } });
    expect(await screen.findByText(/network this page doesn't know: "sepolia"/)).toBeInTheDocument();
  });

  it("re-reads the settings when the settings page announces a save", async () => {
    const { api } = renderApp({ mock: { settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" } } });
    await screen.findByText("No fee recipient set");
    await api.backend.saveSettings(MOCK_SETTINGS);
    act(() => {
      window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
    });
    await waitFor(() => expect(screen.queryByText("No fee recipient set")).toBeNull());
  });

  it("re-reads the settings on every page change", async () => {
    const user = userEvent.setup();
    const { api } = renderApp({ mock: { settings: MOCK_SETTINGS } });
    const get = vi.spyOn(api.backend, "getSettings");
    await screen.findByText("Synced");
    await user.click(within(mainNav()).getByRole("link", { name: "Settings" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });

  it("settings and packages that can't be read raise no banners (nothing known)", async () => {
    const api = createMockApi({ latencyMs: 0, settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" }, packages: [] });
    const get = vi.spyOn(api.backend, "getSettings").mockRejectedValue(new Error("down"));
    const list = vi.spyOn(api.dappmanager, "listPackages").mockRejectedValue(new Error("down"));
    renderApp({ api });
    await screen.findByText("Synced");
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(problems()).toBeNull();
  });
});

describe("Phone layout", () => {
  it("the sidebar is an off-canvas drawer below lg, docked from lg", () => {
    renderApp();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(sidebar).toHaveClass("-translate-x-full", "invisible", "lg:translate-x-0", "lg:visible", "max-w-[85vw]");
    expect(sidebar.className).not.toMatch(/visibility/);
  });

  it("the menu button opens the drawer as a modal dialog; Escape closes it and returns focus", async () => {
    const user = userEvent.setup();
    renderApp();
    const menu = screen.getByRole("button", { name: "Open menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveAttribute("aria-controls", "sidebar");
    await user.click(menu);
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveAttribute("id", "sidebar");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(drawer).toHaveClass("translate-x-0", "visible");
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByTestId("page-behind-drawer")).toHaveAttribute("inert");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("page-behind-drawer")).not.toHaveAttribute("inert");
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
  });

  it("visibility never transitions: shown at once on open, hidden by a timer after the slide-out", async () => {
    // A visibility transition kept focus() from moving in on open, and could
    // leave a closed drawer visible (and tabbable) where transitions stall.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderApp();
      const closed = screen.getByRole("complementary", { name: "Sidebar" });
      expect(closed).toHaveClass("invisible", "-translate-x-full", "transition-transform");
      expect(closed.className).not.toMatch(/visibility/);
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      const open = screen.getByRole("dialog", { name: "Menu" });
      expect(open).toHaveClass("visible", "translate-x-0");
      expect(open.className).not.toMatch(/visibility/);
      await user.keyboard("{Escape}");
      const closing = screen.getByRole("complementary", { name: "Sidebar" });
      expect(closing).toHaveClass("visible", "-translate-x-full");
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(screen.getByRole("complementary", { name: "Sidebar" })).toHaveClass("invisible");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Tab stays inside the open drawer", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("dialog", { name: "Menu" });
    const focusables = Array.from(drawer.querySelectorAll<HTMLElement>("a[href], button"));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    for (let i = 0; i < focusables.length + 2; i++) {
      await user.tab();
      expect(drawer).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("closes when the window grows to the docked (lg) layout", async () => {
    let listener: (() => void) | undefined;
    let matches = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        get matches() {
          return q === "(min-width: 1024px)" ? matches : false;
        },
        media: q,
        addEventListener: (_: string, l: () => void) => {
          if (q === "(min-width: 1024px)") listener = l;
        },
        removeEventListener: () => {},
      })),
    );
    try {
      const user = userEvent.setup();
      renderApp();
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
      matches = true;
      act(() => listener?.());
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the drawer closes on navigation and on the overlay", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(within(mainNav()).getByRole("link", { name: "Add validators" }));
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByTestId("sidebar-overlay"));
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
  });

  it("a skip link moves focus to the page content without changing the route", async () => {
    const user = userEvent.setup();
    renderApp({ path: "/settings" });
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("content can shrink to a phone width: nothing forces a horizontal scroll", async () => {
    renderApp({ mock: { settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" } } });
    await screen.findByText("No fee recipient set");
    const main = screen.getByRole("main");
    expect(main).toHaveClass("min-w-0", "w-full", "px-4");
    expect(main.parentElement).toHaveClass("min-w-0", "lg:pl-[15.5rem]");
    expect(screen.getByRole("region", { name: "Node status" }).querySelector("dl")).toHaveClass("flex-wrap");
    const banner = problems()!.querySelector("[data-problem]")!;
    expect(banner).toHaveClass("flex-col", "sm:flex-row");
    // No fixed widths wider than a 320 px phone in the shell outside the (off-canvas) sidebar.
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>("[class]"))
      .filter((el) => !sidebar.contains(el))
      .filter((el) => /(^|\s)(min-)?w-\[(\d{3,})px\]|(^|\s)(min-)?w-(9[6-9]|[1-9]\d{2,})(\s|$)/.test(el.className));
    expect(offenders).toEqual([]);
  });

  it("touch targets: the menu button and the footer switches are 44 px on phones", () => {
    renderApp();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveClass("h-11", "w-11");
    for (const b of within(screen.getByRole("group", { name: "Mode" })).getAllByRole("button")) expect(b).toHaveClass("h-11");
  });
});
