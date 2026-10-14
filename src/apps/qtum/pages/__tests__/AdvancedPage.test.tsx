import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO_ADDRESSES, DEMO_WIF } from "../../api/fixtures";
import { KEY_WARNING, WEB_WALLET_URL } from "../advanced/AdvancedPage";
import { renderPage } from "./renderPage";

const card = (testId: string) => screen.getByTestId(testId);

describe("Advanced", () => {
  it("shows the private key of a chosen address, with the warning, and forgets it on close", async () => {
    const { posts } = renderPage("/advanced", {}, { advanced: true });
    const select = await within(card("private-key")).findByLabelText("Address");
    await userEvent.selectOptions(select, DEMO_ADDRESSES.savings);
    await userEvent.click(within(card("private-key")).getByRole("button", { name: "Show private key" }));
    const dialog = await screen.findByRole("dialog", { name: "Private key" });
    expect(within(dialog).getByTestId("private-key-value")).toHaveTextContent(DEMO_WIF);
    expect(dialog).toHaveTextContent(DEMO_ADDRESSES.savings);
    expect(dialog).toHaveTextContent(KEY_WARNING);
    expect(posts()).toEqual([{ kind: "POST", path: "/privkey", params: { address: DEMO_ADDRESSES.savings } }]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(DEMO_WIF)).not.toBeInTheDocument();
  });

  it("a key the monitor cannot show: its words", async () => {
    renderPage("/advanced", { failures: { "/privkey": { status: 404, detail: "The private key for this address could not be found in your wallet." } } }, { advanced: true });
    await within(card("private-key")).findByLabelText("Address");
    await userEvent.click(within(card("private-key")).getByRole("button", { name: "Show private key" }));
    expect(await screen.findByTestId("private-key-error")).toHaveTextContent("The private key for this address could not be found in your wallet.");
  });

  it("imports a private key and follows the import; the key field is cleared", async () => {
    const { api, posts } = renderPage("/advanced", {}, { advanced: true });
    const field = within(card("import-key")).getByLabelText("Private key");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.type(field, "not a key");
    await userEvent.click(within(card("import-key")).getByRole("button", { name: "Import" }));
    expect(await screen.findByTestId("import-error")).toHaveTextContent("This is not a valid Qtum private key. Please check that you copied all of it.");
    expect(field).toHaveValue("");
    await userEvent.type(field, DEMO_WIF);
    await userEvent.click(within(card("import-key")).getByRole("button", { name: "Import" }));
    expect(await screen.findByTestId("import-status")).toHaveTextContent(
      "Importing: your wallet is searching the Qtum blockchain for this key's coins (12% done). This can take a few hours. You can close this page; the import continues.",
    );
    expect(posts().map((c) => c.path)).toEqual(["/importkey", "/importkey"]);
    expect(JSON.stringify(api.calls)).not.toContain(DEMO_WIF);
    // The monitor finishes the import; the page reads it on its next poll.
    api.state.walletStatus = { ...api.state.walletStatus, import: { state: "done" }, scanning: false };
    await act(() => new Promise((r) => setTimeout(r, 5_200)));
    expect(screen.getByTestId("import-status")).toHaveTextContent("The private key was imported. Please download a fresh wallet backup.");
  }, 10_000);

  it("shows the node's last log lines", async () => {
    const { api } = renderPage("/advanced", {}, { advanced: true });
    const lines = await within(card("node-log")).findByTestId("log-lines");
    expect(lines).toHaveTextContent("Staker: searching for a stake");
    expect(api.calls.find((c) => c.path === "/logs")?.params).toEqual({ lines: 200 });
  });

  it("links to the Qtum Web Wallet in a new tab", async () => {
    renderPage("/advanced", {}, { advanced: true });
    const link = within(card("web-wallet")).getByRole("link", { name: /Qtum Web Wallet \(advanced\)/ });
    expect(link).toHaveAttribute("href", WEB_WALLET_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("is reachable in Simple mode too (only the sidebar hides it)", async () => {
    renderPage("/advanced");
    expect(screen.getByRole("heading", { level: 1, name: "Advanced" })).toBeInTheDocument();
    await waitFor(() => expect(within(card("node-log")).getByTestId("log-lines")).toBeInTheDocument());
  });
});
