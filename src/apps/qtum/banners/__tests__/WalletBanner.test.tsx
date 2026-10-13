import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WalletStatus } from "../../api/models";
import { mockDownloads, renderPage } from "../../pages/__tests__/renderPage";
import { LOCKED_NOTE } from "../WalletBanner";

const banner = () => screen.findByRole("region", { name: "Wallet status" });

const migration = (over: Partial<NonNullable<WalletStatus["migration"]>> = {}): WalletStatus["migration"] => ({
  state: "failed",
  method: "upgrade",
  migratedAt: null,
  failedAt: "2026-10-13T08:00:00Z",
  error: "corrupt",
  encrypted: false,
  canRebuild: true,
  ...over,
});
const rebuild = (over: Partial<NonNullable<WalletStatus["rebuild"]>> = {}): WalletStatus["rebuild"] => ({
  state: "running",
  step: null,
  progress: null,
  error: null,
  notCarriedOver: "",
  source: null,
  seedRestored: false,
  ...over,
});

describe("Wallet status banners (the old wizard's states and wording)", () => {
  it("none while the wallet is ready", async () => {
    renderPage("/");
    await screen.findByText("Running");
    expect(screen.queryByRole("region", { name: "Wallet status" })).not.toBeInTheDocument();
  });

  it("migrating, without and with a password", async () => {
    const { unmount } = renderPage("/", { walletStatus: { state: "migrating", migration: migration({ state: "pending" }) } });
    let b = await banner();
    expect(within(b).getByTestId("banner-migrating")).toHaveTextContent(
      "Upgrading your wallet to the new Qtum wallet format. This happens once and takes a few minutes. A copy of your old wallet was saved first, so your coins are safe. Staking starts again by itself when the upgrade is done.",
    );
    unmount();
    renderPage("/", { walletStatus: { state: "migrating", migration: migration({ state: "pending", encrypted: true }) } });
    b = await banner();
    expect(within(b).getByTestId("banner-migrating")).not.toHaveTextContent("Staking starts again");
  });

  it("rebuilding: the step and the percentage", async () => {
    renderPage("/", { scenario: "rebuilding" });
    const b = await banner();
    expect(within(b).getByTestId("banner-rebuilding")).toHaveTextContent(
      "Rebuilding your wallet from the copy of your old wallet. This can take a few hours. Your old wallet stays on your AVADO, so your coins are safe. Staking starts again by itself when it is done.",
    );
    expect(within(b).getByTestId("rebuild-step")).toHaveTextContent("Scanning the blockchain for your coins: 42 %");
  });

  it("restoring", async () => {
    renderPage("/wallet", { scenario: "restoring" });
    const b = await banner();
    expect(within(b).getByTestId("banner-restoring")).toHaveTextContent(
      "Restoring your wallet backup. This takes a few minutes. Your previous wallet was saved on your AVADO first.",
    );
  });

  it("needs the password to finish the upgrade: sends it once, clears it", async () => {
    const { api, posts } = renderPage("/", { scenario: "needs-password" });
    const b = await banner();
    expect(within(b).getByTestId("banner-needs-passphrase")).toHaveTextContent(
      `Your wallet is protected with a password. Enter it once to finish the upgrade to the new Qtum wallet format. Your coins are safe. ${LOCKED_NOTE}`,
    );
    const button = within(b).getByRole("button", { name: "Finish upgrade" });
    expect(button).toBeDisabled();
    await userEvent.type(within(b).getByLabelText("Wallet password"), "demo password");
    await userEvent.click(button);
    await waitFor(() => expect(posts()).toEqual([{ kind: "POST", path: "/migrate", params: { passphrase: "demo password" } }]));
    // The banner moves on to the upgrade (the monitor's next state).
    expect(api.state.walletStatus.state).toBe("migrating");
    expect(await within(await banner()).findByTestId("banner-migrating")).toBeInTheDocument();
  });

  it("needs the password for a rebuild: Rebuild wallet sends it to the rebuild", async () => {
    const { posts } = renderPage("/", {
      walletStatus: { state: "needs-passphrase", migration: migration({ state: "needs-passphrase", encrypted: true }), rebuild: rebuild({ state: "needs-passphrase" }) },
    });
    const b = await banner();
    expect(b).toHaveTextContent("Enter it once to rebuild your wallet in the new Qtum wallet format.");
    await userEvent.type(within(b).getByLabelText("Wallet password"), "pw");
    await userEvent.click(within(b).getByRole("button", { name: "Rebuild wallet" }));
    await waitFor(() => expect(posts()).toEqual([{ kind: "POST", path: "/rebuild", params: { passphrase: "pw" } }]));
  });

  it("the wallet file is missing: no actions, details on request", async () => {
    renderPage("/", { walletStatus: { state: "failed", problem: "wallet-missing", message: "wallet.dat not found" } });
    const b = await banner();
    expect(within(b).getByTestId("banner-wallet-missing")).toHaveTextContent(
      "Your wallet file is missing. Your coins are safe: copies of your wallet are kept on your AVADO, and no new, empty wallet was made in its place. Staking is paused. Please contact AVADO support.",
    );
    expect(within(b).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(within(b).queryByText("wallet.dat not found")).not.toBeInTheDocument();
    await userEvent.click(within(b).getByRole("button", { name: "Details" }));
    expect(within(b).getByText("wallet.dat not found")).toBeInTheDocument();
    expect(within(b).getByRole("button", { name: "Hide details" })).toBeInTheDocument();
  });

  it("the upgrade failed: Try again retries it", async () => {
    const { posts } = renderPage("/", { scenario: "upgrade-failed" });
    const b = await banner();
    expect(within(b).getByTestId("banner-failed")).toHaveTextContent(
      "Your wallet could not be upgraded to the new Qtum wallet format. Your coins are safe: a copy of your old wallet is kept on your AVADO. Staking is paused until the upgrade works.",
    );
    expect(b).toHaveTextContent("If this keeps happening, please contact AVADO support.");
    await userEvent.click(within(b).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(posts()).toEqual([{ kind: "POST", path: "/migrate", params: {} }]));
  });

  it("the upgrade failed: Rebuild asks first, with the old wording, then rebuilds; Cancel does nothing", async () => {
    const { posts, api } = renderPage("/", { scenario: "upgrade-failed" });
    const b = await banner();
    await userEvent.click(within(b).getByRole("button", { name: "Rebuild the wallet from the old copy" }));
    const confirm = within(b).getByTestId("rebuild-confirm");
    expect(confirm).toHaveTextContent(
      "This reads every key from the copy of your old wallet, creates a new wallet in the new format with the same keys, and checks that nothing is missing before it is used. Your old wallet stays on the AVADO. Scanning the blockchain can take a few hours. When it is done, staking starts again by itself.",
    );
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(within(b).queryByTestId("rebuild-confirm")).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
    await userEvent.click(within(b).getByRole("button", { name: "Rebuild the wallet from the old copy" }));
    await userEvent.click(within(within(b).getByTestId("rebuild-confirm")).getByRole("button", { name: "Rebuild" }));
    await waitFor(() => expect(posts()).toEqual([{ kind: "POST", path: "/rebuild", params: {} }]));
    expect(api.state.walletStatus.state).toBe("rebuilding");
    expect(await within(await banner()).findByTestId("banner-rebuilding")).toBeInTheDocument();
  });

  it("the rebuild confirmation for a wallet with a password", async () => {
    renderPage("/", { scenario: "upgrade-failed", walletStatus: { migration: migration({ encrypted: true }) } });
    const b = await banner();
    await userEvent.click(within(b).getByRole("button", { name: "Rebuild the wallet from the old copy" }));
    expect(within(b).getByTestId("rebuild-confirm")).toHaveTextContent(
      "Your wallet has a password: you are asked for it before the keys are read, and the new wallet stays locked and does not stake, as after the upgrade.",
    );
  });

  it("no Rebuild button when a rebuild is not possible", async () => {
    renderPage("/", { scenario: "upgrade-failed", walletStatus: { migration: migration({ canRebuild: false }) } });
    const b = await banner();
    expect(within(b).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(b).queryByRole("button", { name: "Rebuild the wallet from the old copy" })).not.toBeInTheDocument();
  });

  it("the rebuild failed", async () => {
    renderPage("/", { scenario: "upgrade-failed", walletStatus: { rebuild: rebuild({ state: "failed", error: "a key is missing" }) } });
    const b = await banner();
    expect(within(b).getByTestId("banner-failed")).toHaveTextContent(
      "Your wallet could not be rebuilt. Your coins are safe: your old wallet was not changed and a copy of it is kept on your AVADO. Staking is paused until your wallet is in the new Qtum wallet format.",
    );
  });

  it("another wallet problem", async () => {
    renderPage("/", { walletStatus: { state: "failed", message: "qtumd did not start" } });
    const b = await banner();
    expect(within(b).getByTestId("banner-failed")).toHaveTextContent(
      "There is a problem with your Qtum wallet. Your coins are safe. Please try again, or restart the Qtum package.",
    );
    expect(within(b).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("an action the monitor refuses shows the monitor's words", async () => {
    renderPage("/", { scenario: "upgrade-failed", failures: { "/migrate": { status: 409, detail: "Your Qtum wallet is busy right now. Please try again in a few minutes." } } });
    const b = await banner();
    await userEvent.click(within(b).getByRole("button", { name: "Try again" }));
    expect(await within(b).findByText("Your Qtum wallet is busy right now. Please try again in a few minutes.")).toBeInTheDocument();
  });

  it("an action that gets no answer shows the old fallback", async () => {
    renderPage("/", { scenario: "upgrade-failed", failures: { "/rebuild": { status: 502 } } });
    const b = await banner();
    await userEvent.click(within(b).getByRole("button", { name: "Rebuild the wallet from the old copy" }));
    await userEvent.click(within(within(b).getByTestId("rebuild-confirm")).getByRole("button", { name: "Rebuild" }));
    expect(await within(b).findByText("The rebuild could not be started. Please try again.")).toBeInTheDocument();
  });

  it("upgraded: asks for a fresh backup; the download records it and the banner goes", async () => {
    const downloads = mockDownloads();
    try {
      const { posts } = renderPage("/", {
        walletStatus: { newBackupRequired: true, migration: migration({ state: "done", method: "upgrade", encrypted: true }) },
      });
      const b = await banner();
      const box = within(b).getByTestId("banner-new-backup");
      expect(box).toHaveTextContent(
        "Your wallet was upgraded to the new Qtum wallet format. Please download a fresh backup now and keep it somewhere safe. Backups made before the upgrade do not include the new wallet format.",
      );
      expect(box).toHaveTextContent(LOCKED_NOTE);
      await userEvent.click(within(box).getByRole("button", { name: "Download wallet backup" }));
      await waitFor(() => expect(posts().map((c) => c.path)).toEqual(["/backup", "/backupdone"]));
      expect(downloads.names).toEqual([expect.stringMatching(/^qtum-wallet-\d{4}-\d{2}-\d{2}\.dat$/)]);
      await waitFor(() => expect(screen.queryByRole("region", { name: "Wallet status" })).not.toBeInTheDocument());
    } finally {
      downloads.restore();
    }
  });

  it("rebuilt from a damaged file: the one-sentence note and what was not carried over", async () => {
    renderPage("/", { scenario: "rebuilt" });
    const b = await banner();
    const box = within(b).getByTestId("banner-new-backup");
    expect(box).toHaveTextContent("Your wallet was rebuilt in the new Qtum wallet format.");
    expect(box).toHaveTextContent("Backups made before the rebuild do not include the new wallet format.");
    expect(within(box).getByTestId("damaged-note")).toHaveTextContent("The old wallet file was damaged; the keys that could be read were carried over.");
    expect(box).toHaveTextContent("Not carried over to the new wallet: 2 tokens. The old wallet still has them.");
    expect(box).not.toHaveTextContent(LOCKED_NOTE);
  });

  it("rebuilt from a damaged file with its seed: says all seed addresses were restored", async () => {
    renderPage("/", { scenario: "rebuilt", walletStatus: { rebuild: rebuild({ state: "done", source: "raw-pages", seedRestored: true }) } });
    const b = await banner();
    expect(within(b).getByTestId("damaged-note")).toHaveTextContent(
      "The old wallet file was damaged; the keys that could be read were carried over and all addresses from its seed were restored.",
    );
  });

  it("rebuilt normally: no damaged-file note", async () => {
    renderPage("/", { scenario: "rebuilt", walletStatus: { rebuild: rebuild({ state: "done", source: "dump" }) } });
    const b = await banner();
    expect(within(b).queryByTestId("damaged-note")).not.toBeInTheDocument();
  });

  it("a failed restore shows above the rest until OK", async () => {
    renderPage("/", {
      scenario: "upgrade-failed",
      walletStatus: { restore: { state: "failed", message: "There is not enough free disk space on your AVADO.", at: "2026-10-13T09:00:00Z" } },
    });
    const b = await banner();
    const failed = within(b).getByTestId("banner-restore-failed");
    expect(failed).toHaveTextContent(
      "Your backup could not be restored. There is not enough free disk space on your AVADO. Your wallet was not changed. Please try again.",
    );
    expect(within(b).getByTestId("banner-failed")).toBeInTheDocument();
    await userEvent.click(within(failed).getByRole("button", { name: "OK" }));
    expect(within(b).queryByTestId("banner-restore-failed")).not.toBeInTheDocument();
    expect(within(b).getByTestId("banner-failed")).toBeInTheDocument();
  });
});
