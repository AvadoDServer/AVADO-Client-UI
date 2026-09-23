import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    window.location.hash = "";
  });

  it("loads the runtime config and renders the shell on the mock API, routing by hash", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ client: "nimbus", network: "mainnet" }) }),
    );
    window.location.hash = "#/settings";
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    const sidebar = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(sidebar).getByText("Nimbus")).toBeInTheDocument();
    expect(await screen.findByText("Synced", {}, { timeout: 3000 })).toBeInTheDocument();

    await userEvent.click(within(sidebar).getByRole("link", { name: "Validators" }));
    expect(window.location.hash).toBe("#/");
    expect(screen.getByRole("heading", { level: 1, name: "Validators" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
