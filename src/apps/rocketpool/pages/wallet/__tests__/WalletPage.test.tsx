import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO, DemoSnError } from "../../../api/fixtures";
import { renderPage } from "../../__tests__/renderPage";

const dialog = () => screen.getByRole("dialog");

describe("Wallet page", () => {
  it("shows the node wallet, its balances and where rewards go", async () => {
    renderPage("/wallet", { scenario: "minipool" });
    const wallet = await screen.findByTestId("node-wallet", {}, { timeout: 3000 });
    expect(within(wallet).getByText(DEMO.nodeAddress)).toBeInTheDocument();
    expect(await within(wallet).findByText("0.4128 ETH")).toBeInTheDocument();
    expect(within(wallet).getByText("12.5 RPL")).toBeInTheDocument();
    expect(screen.getByText("Withdrawal address").nextElementSibling).toHaveTextContent(DEMO.coldWallet);
  });

  it("a withdrawal address that is still the node wallet links to the setup step that sets one", async () => {
    renderPage("/wallet", { scenario: "mixed" });
    expect(await screen.findByText(/This is still the node wallet/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "set one" })).toHaveAttribute("href", "/setup/withdrawal");
  });

  it("exports only after EXPORT is typed; secrets are hidden until asked for and gone after closing", async () => {
    const { posts } = renderPage("/wallet", { scenario: "minipool" });
    await userEvent.click(await screen.findByRole("button", { name: "Back up the wallet…" }, { timeout: 3000 }));
    const show = within(dialog()).getByRole("button", { name: "Show the backup" });
    expect(show).toBeDisabled();
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "export");
    expect(show).toBeDisabled();
    await userEvent.clear(within(dialog()).getByLabelText(/to confirm/));
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "EXPORT");
    await userEvent.click(show);
    expect(await screen.findByRole("dialog", { name: "Your wallet backup" })).toBeInTheDocument();
    expect(posts()).toEqual([{ method: "POST", path: "/api/sn/wallet/export", params: { typedConfirmation: "EXPORT" } }]);
    expect(screen.queryByText("demo-password-not-real", { exact: false })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Show the values on screen" }));
    expect(within(screen.getByTestId("export-values")).getByText(/demo-password-not-real/)).toBeInTheDocument();

    // The download is built on the click from memory: a blob, never a link to the backend.
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:demo";
    });
    const revoke = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(within(dialog()).getByRole("button", { name: "Download the backup file" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith("blob:demo");
    click.mockRestore();
    Object.assign(URL, original);
    const text = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsText(blobs[0]);
    });
    const content = JSON.parse(text);
    expect(content).toMatchObject({ nodeAddress: DEMO.nodeAddress, password: "demo-password-not-real", walletFile: '{"demo":"not a real wallet"}' });

    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/demo-password-not-real/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Back up the wallet…" }));
    expect(within(dialog()).getByRole("button", { name: "Show the backup" })).toBeDisabled();
    expect(posts()).toHaveLength(1);
  });

  it("says why an export failed", async () => {
    renderPage("/wallet", { scenario: "minipool", failures: { "wallet/export": new DemoSnError(500, "could not read the wallet") } });
    await userEvent.click(await screen.findByRole("button", { name: "Back up the wallet…" }, { timeout: 3000 }));
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "EXPORT");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Show the backup" }));
    expect(await within(dialog()).findByText("could not read the wallet.")).toBeInTheDocument();
  });

  it("lists the backups on the box with their paths and how to download them", async () => {
    renderPage("/wallet", { scenario: "exits" });
    const box = await screen.findByTestId("backups", {}, { timeout: 3000 });
    const items = within(box).getAllByRole("listitem");
    expect(items.map((i) => within(i).getByText(/^\/rocketpool\/backups\//).textContent)).toEqual([
      "/rocketpool/backups/1.0.0-20260921T090000Z",
      "/rocketpool/backups/20260920T120000Z-before-wallet-change",
      "/rocketpool/backups/legacy-20260919T081100Z",
    ]);
    expect(within(items[2]).getByText("Before the upgrade from the old package")).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: /Rocket Pool package in the AVADO Admin/ })).toHaveAttribute(
      "href",
      "http://my.ava.do/#/packages/rocketpool.avado.dnp.dappnode.eth",
    );
  });

  it("moves the old recovery-phrase file into the backups after ARCHIVE is typed", async () => {
    const { posts } = renderPage("/wallet", { scenario: "mixed" });
    await userEvent.click(await screen.findByRole("button", { name: "Move the file…" }, { timeout: 3000 }));
    const move = within(dialog()).getByRole("button", { name: "Move the file" });
    expect(move).toBeDisabled();
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "ARCHIVE");
    await userEvent.click(move);
    const done = (await screen.findByText("The recovery phrase file was moved")).closest("div.flex") as HTMLElement;
    expect(within(done).getByText("/rocketpool/backups/mnemonic-archive-20260923T101500Z")).toBeInTheDocument();
    expect(posts()).toEqual([{ method: "POST", path: "/api/avado/legacy-mnemonic/archive", params: { confirm: "ARCHIVE" } }]);
    // The shell's banner goes away with the next status.
    await waitFor(() => expect(screen.queryByText("Your recovery phrase is stored in a plain file")).toBeNull(), { timeout: 3000 });
    expect(within(screen.getByTestId("backups")).getByText("Old recovery phrase file")).toBeInTheDocument();
  });

  it("without a wallet: set up first, and no backups yet", async () => {
    renderPage("/wallet", { scenario: "fresh" });
    expect(await screen.findByText("Your node isn't set up yet", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(screen.getByTestId("backups")).getByText(/No backups yet/)).toBeInTheDocument();
  });
});
