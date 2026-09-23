import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("loads the runtime config and renders the placeholder page on the mock API", async () => {
    vi.stubEnv("VITE_MOCK", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ client: "nimbus", network: "mainnet" }) }),
    );
    render(<App />);
    expect(await screen.findByRole("heading", { name: "AVADO Nimbus" })).toBeInTheDocument();
    expect(screen.getByText("nimbus.avado.dnp.dappnode.eth")).toBeInTheDocument();
    expect(await screen.findByText("5 keys", {}, { timeout: 2000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
