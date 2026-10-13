import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO_ADDRESSES, DEMO_PASSWORD } from "../../api/fixtures";
import { STAKING_UNLOCK_SECONDS } from "../../api/models";
import { mockDownloads, renderPage } from "./renderPage";

const region = (name: string) => screen.getByRole("region", { name });

describe("Wallet", () => {
  it("lists the addresses with their labels, each with a copy button", async () => {
    renderPage("/wallet");
    const list = await screen.findByRole("list", { name: "Wallet addresses" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.replace("Copy", ""))).toEqual([`No label${DEMO_ADDRESSES.main}`, `savings${DEMO_ADDRESSES.savings}`]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await userEvent.click(within(items[0]).getByRole("button", { name: `Copy address ${DEMO_ADDRESSES.main}` }));
    expect(writeText).toHaveBeenCalledWith(DEMO_ADDRESSES.main);
    expect(await within(items[0]).findByText("Copied")).toBeInTheDocument();
  });

  it("makes a new address with a name (a plain address, which can stake)", async () => {
    const { rpcs } = renderPage("/wallet");
    await screen.findByRole("list", { name: "Wallet addresses" });
    await userEvent.type(screen.getByLabelText("Name for a new address (optional)"), "  cold  ");
    await userEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    expect(await screen.findByTestId("address-outcome")).toHaveTextContent(`New address made: ${DEMO_ADDRESSES.new[0]}`);
    expect(rpcs("getnewaddress")).toEqual([{ kind: "rpc", path: "getnewaddress", params: ["cold", "legacy"] }]);
    const list = screen.getByRole("list", { name: "Wallet addresses" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByLabelText("Name for a new address (optional)")).toHaveValue("");
  });

  it("a wallet with no address yet gets one, as with the old wizard", async () => {
    const { rpcs } = renderPage("/wallet", { scenario: "backup-required" });
    const list = await screen.findByRole("list", { name: "Wallet addresses" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(rpcs("getnewaddress")).toEqual([{ kind: "rpc", path: "getnewaddress", params: ["", "legacy"] }]);
    expect(within(region("Backup")).getByTestId("backup-required")).toHaveTextContent("You have not downloaded a backup of this wallet yet.");
  });

  it("no staking-password section for a wallet without a password", async () => {
    renderPage("/wallet");
    await screen.findByRole("list", { name: "Wallet addresses" });
    expect(screen.queryByTestId("staking-password")).not.toBeInTheDocument();
  });

  it("unlocks a locked wallet for staking only: a wrong password is said plainly, the password is never kept", async () => {
    const { rpcs } = renderPage("/wallet", { scenario: "locked" });
    const card = await screen.findByTestId("staking-password");
    expect(within(card).getByTestId("lock-state")).toHaveTextContent("Locked");
    const field = within(card).getByLabelText("Wallet password");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.type(field, "wrong");
    await userEvent.click(within(card).getByRole("button", { name: "Unlock for staking" }));
    expect(await within(card).findByTestId("unlock-outcome")).toHaveTextContent("That password is not right. Please check it and try again.");
    expect(field).toHaveValue("");
    await userEvent.type(field, DEMO_PASSWORD);
    await userEvent.click(within(card).getByRole("button", { name: "Unlock for staking" }));
    await waitFor(() => expect(within(card).getByTestId("lock-state")).toHaveTextContent("Unlocked for staking"));
    expect(within(card).getByTestId("unlock-outcome")).toHaveTextContent("Your wallet is unlocked for staking. It can stake, but it cannot send coins.");
    expect(rpcs("walletpassphrase").map((c) => c.params)).toEqual([
      ["wrong", STAKING_UNLOCK_SECONDS, true],
      [DEMO_PASSWORD, STAKING_UNLOCK_SECONDS, true],
    ]);
    // Never stored by the page.
    expect(JSON.stringify(localStorage)).not.toContain(DEMO_PASSWORD);
    await userEvent.click(within(card).getByRole("button", { name: "Lock the wallet" }));
    await waitFor(() => expect(within(card).getByTestId("lock-state")).toHaveTextContent("Locked"));
    expect(rpcs("walletlock")).toHaveLength(1);
  });

  it("downloads a backup and records it", async () => {
    const downloads = mockDownloads();
    try {
      const { posts } = renderPage("/wallet");
      await screen.findByRole("list", { name: "Wallet addresses" });
      await userEvent.click(within(region("Backup")).getByRole("button", { name: "Download wallet backup" }));
      expect(await within(region("Backup")).findByTestId("backup-saved")).toHaveTextContent("Your wallet backup was downloaded.");
      expect(posts().map((c) => c.path)).toEqual(["/backup", "/backupdone"]);
      expect(downloads.names[0]).toMatch(/^qtum-wallet-\d{4}-\d{2}-\d{2}\.dat$/);
    } finally {
      downloads.restore();
    }
  });

  it("restores a backup: asks first with the old wording, uploads the file, starts the restore", async () => {
    const { posts, api } = renderPage("/wallet");
    await screen.findByRole("list", { name: "Wallet addresses" });
    const file = new File([new Uint8Array([1, 2, 3])], "wallet.dat");
    fireEvent.change(screen.getByTestId("restore-file"), { target: { files: [file] } });
    const dialog = await screen.findByRole("dialog", { name: "Restore this wallet backup?" });
    expect(dialog).toHaveTextContent("The wallet on your AVADO will be replaced by the backup. Your current wallet is saved on your AVADO first, so nothing is lost.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    expect(await screen.findByTestId("restore-outcome")).toHaveTextContent(
      "Your backup is being restored. This takes a few minutes; the status is shown at the top of this page.",
    );
    expect(posts()).toEqual([
      { kind: "POST", path: "/uploadbackup", params: { size: 3 } },
      { kind: "POST", path: "/restore", params: { file: "wallet-upload.dat" } },
    ]);
    expect(api.state.walletStatus.state).toBe("restoring");
    expect(await screen.findByTestId("banner-restoring")).toBeInTheDocument();
  });

  it("a restore can be cancelled: nothing is sent", async () => {
    const { posts } = renderPage("/wallet");
    await screen.findByRole("list", { name: "Wallet addresses" });
    fireEvent.change(screen.getByTestId("restore-file"), { target: { files: [new File(["x"], "w.dat")] } });
    const dialog = await screen.findByRole("dialog", { name: "Restore this wallet backup?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
  });

  it("a backup the monitor refuses: its words, the wallet unchanged", async () => {
    renderPage("/wallet", { failures: { "/restore": { status: 400, detail: "This file is not a Qtum wallet backup." } } });
    await screen.findByRole("list", { name: "Wallet addresses" });
    fireEvent.change(screen.getByTestId("restore-file"), { target: { files: [new File(["x"], "photo.jpg")] } });
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore" }));
    expect(await screen.findByTestId("restore-outcome")).toHaveTextContent("This file is not a Qtum wallet backup.");
  });
});
