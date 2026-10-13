import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockDownloads, renderPage } from "./renderPage";

const fact = (testId: string, label: string) => within(screen.getByTestId(testId)).getByText(label).nextElementSibling?.textContent;
const stakingState = () => screen.getByTestId("staking-state");
const reason = () => screen.getByTestId("staking-reason");

describe("Home", () => {
  it("a staking node: wallet, staking with the expected time, rewards; reads only", async () => {
    const { posts, rpcs } = renderPage("/");
    await waitFor(() => expect(fact("wallet-facts", "Balance")).toBe("2,498.5234 QTUM"));
    expect(fact("wallet-facts", "Available")).toBe("2,498.1234 QTUM");
    expect(fact("wallet-facts", "In a recent stake")).toBe("0.4 QTUM");
    expect(fact("wallet-facts", "Password")).toBe("None");
    await waitFor(() => expect(stakingState()).toHaveTextContent("Staking"));
    expect(fact("staking-facts", "Next reward expected in")).toBe("about 3 days");
    await waitFor(() => expect(fact("rewards-facts", "Total earned")).toBe("18.4 QTUM"));
    expect(fact("rewards-facts", "Last 30 days")).toBe("1.6 QTUM");
    expect(fact("rewards-facts", "Rewards in the last 30 days")).toBe("4");
    expect(fact("rewards-facts", "Rewards in total")).toBe("46");
    expect(screen.queryByTestId("backup-callout")).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
    expect(rpcs("getnewaddress")).toEqual([]);
  });

  it("syncing: not staking yet, because the node is catching up", async () => {
    renderPage("/", { scenario: "syncing" });
    await waitFor(() => expect(stakingState()).toHaveTextContent("Not staking yet"));
    expect(reason()).toHaveTextContent("The Qtum node is still catching up with the network. Staking starts by itself once it has caught up.");
    expect(await screen.findByTestId("balance-syncing")).toHaveTextContent("The balance may be incomplete until the node has caught up with the network.");
  });

  it("locked: not staking, with the way to unlock it", async () => {
    renderPage("/", { scenario: "locked" });
    await waitFor(() => expect(reason()).toHaveTextContent("Your wallet is locked with a password, and a locked wallet does not stake."));
    expect(fact("wallet-facts", "Password")).toBe("Locked");
    await userEvent.click(screen.getByRole("link", { name: "Unlock for staking" }));
    expect(screen.getByRole("heading", { level: 1, name: "Wallet" })).toBeInTheDocument();
  });

  it("no coins: says to send QTUM to an address", async () => {
    renderPage("/", { scenario: "staking", wallet: { trusted: 0, stake: 0 }, node: { weight: 0 } });
    await waitFor(() => expect(reason()).toHaveTextContent("Your wallet has no coins yet. Send QTUM to one of your addresses on the Wallet page"));
  });

  it("coins too new to stake", async () => {
    renderPage("/", { scenario: "staking", node: { weight: 0 } });
    await waitFor(() => expect(reason()).toHaveTextContent("Your coins are not ready to stake yet. Coins can stake once they are 500 blocks old"));
  });

  it("staking turned off in the node", async () => {
    renderPage("/", { scenario: "staking", node: { stakingEnabled: false } });
    await waitFor(() => expect(stakingState()).toHaveTextContent("Staking is off"));
  });

  it("a wallet that needs attention: points at the message at the top", async () => {
    renderPage("/", { scenario: "upgrade-failed" });
    await waitFor(() => expect(reason()).toHaveTextContent("Your wallet is not ready, so it does not stake."));
    expect(screen.getByRole("region", { name: "Wallet" })).toHaveTextContent("Shows here once your wallet is ready.");
  });

  it("the node is starting: nothing is read from the wallet yet", async () => {
    const { rpcs } = renderPage("/", { scenario: "fresh" });
    expect(await screen.findByText("Starting")).toBeInTheDocument();
    expect(rpcs("getbalances")).toEqual([]);
    expect(screen.getByRole("region", { name: "Rewards" })).toHaveTextContent("Shows here once your wallet is ready.");
  });

  it("rewards that cannot be read say so in plain words", async () => {
    renderPage("/", { failures: { "/staking-summary": { status: 500, detail: "Your wallet is not loaded yet. Please wait a moment and try again." } } });
    expect(await screen.findByText(/Could not read your rewards\. Your wallet is not loaded yet/)).toBeInTheDocument();
  });

  it("backup required: the callout makes an address, downloads the backup, records it, and goes away", async () => {
    const downloads = mockDownloads();
    try {
      const { posts, rpcs, api } = renderPage("/", { scenario: "backup-required" });
      const callout = await screen.findByTestId("backup-callout");
      expect(callout).toHaveTextContent("Back up your wallet");
      await userEvent.click(within(callout).getByRole("button", { name: "Download wallet backup" }));
      await waitFor(() => expect(posts().map((c) => c.path)).toEqual(["/backup", "/backupdone"]));
      expect(rpcs("getnewaddress")).toEqual([{ kind: "rpc", path: "getnewaddress", params: ["", "legacy"] }]);
      expect(downloads.names).toHaveLength(1);
      expect(downloads.blobs[0].size).toBe(16);
      expect(api.state.settings.BACKUP_REQUIRED).toBe(false);
      await waitFor(() => expect(screen.queryByTestId("backup-callout")).not.toBeInTheDocument());
    } finally {
      downloads.restore();
    }
  });

  it("a backup that cannot be made: the old wizard's message, the reminder stays", async () => {
    const downloads = mockDownloads();
    try {
      const { posts } = renderPage("/", { scenario: "backup-required", failures: { "/backup": { status: 500, detail: "Your wallet is not loaded yet." } } });
      const callout = await screen.findByTestId("backup-callout");
      await userEvent.click(within(callout).getByRole("button", { name: "Download wallet backup" }));
      expect(await within(callout).findByTestId("backup-failed")).toHaveTextContent(
        "The backup could not be downloaded. If the Qtum node is still starting, please try again in a few minutes.",
      );
      expect(posts().map((c) => c.path)).toEqual(["/backup"]);
      expect(downloads.names).toEqual([]);
      expect(screen.getByTestId("backup-callout")).toBeInTheDocument();
    } finally {
      downloads.restore();
    }
  });
});
