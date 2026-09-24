import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO } from "../../../api/fixtures";
import { confirmIn, renderPage } from "../../__tests__/renderPage";

const dialog = () => screen.getByRole("dialog");

describe("Rewards page", () => {
  it("shows the total, where it is paid, and each source", async () => {
    renderPage("/rewards", { scenario: "minipool" });
    expect(await screen.findByTestId("claim-total", {}, { timeout: 3000 })).toHaveTextContent("0.2132 ETH + 36.34 RPL");
    const summary = screen.getByTestId("claim-summary");
    expect(within(summary).getByRole("link", { name: /opens Etherscan/ })).toHaveAttribute("href", `https://etherscan.io/address/${DEMO.coldWallet}`);
    expect(within(summary).getByRole("button", { name: "Claim everything (4 transactions)" })).toBeInTheDocument();
    expect(within(screen.getByTestId("claim-periodic")).getByText("0.08 ETH + 36.34 RPL")).toBeInTheDocument();
    expect(screen.getByText(/Your node is in the smoothing pool/)).toBeInTheDocument();
  });

  it("claims everything one confirmed transaction at a time, and stops when the owner cancels", async () => {
    const { posts } = renderPage("/rewards", { scenario: "minipool" });
    await userEvent.click(await screen.findByRole("button", { name: "Claim everything (4 transactions)" }, { timeout: 3000 }));
    expect(await screen.findByRole("dialog", { name: /Step 1 of 4: Distribute the rewards of minipool/ })).toBeInTheDocument();
    await confirmIn(dialog(), "Distribute");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()).toHaveLength(1);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
    // The next one opens by itself, but is not sent without its own confirm.
    expect(await screen.findByRole("dialog", { name: /Step 2 of 4/ })).toBeInTheDocument();
    await within(dialog()).findByRole("button", { name: "Distribute" });
    expect(posts()).toHaveLength(1);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("1 of 4 claimed. You can claim the rest below, one at a time.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts().map((p) => p.path)).toEqual(["/api/sn/minipool/distribute-balance"]);
  });

  it("claims the periodic rewards and stakes the chosen RPL again", async () => {
    const { posts } = renderPage("/rewards", { scenario: "minipool" });
    const card = await screen.findByTestId("claim-periodic", {}, { timeout: 3000 });
    await userEvent.click(within(card).getByLabelText("Stake the RPL again instead of paying it out"));
    await userEvent.type(within(card).getByLabelText("RPL to stake"), "0");
    expect(within(card).getByText("Enter more than 0, or untick staking to claim it all")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Claim and stake" })).toBeDisabled();
    await userEvent.clear(within(card).getByLabelText("RPL to stake"));
    await userEvent.type(within(card).getByLabelText("RPL to stake"), "40");
    expect(within(card).getByText("At most 36.34 RPL")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Claim and stake" })).toBeDisabled();
    await userEvent.clear(within(card).getByLabelText("RPL to stake"));
    await userEvent.type(within(card).getByLabelText("RPL to stake"), "10.5");
    await userEvent.click(within(card).getByRole("button", { name: "Claim and stake" }));
    expect(await within(dialog()).findByText(/10.5 RPL is staked on your node again/)).toBeInTheDocument();
    await confirmIn(dialog(), "Claim and stake");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({
      path: "/api/sn/node/claim-and-stake-rewards",
      params: { indices: "42,43", stakeAmount: "10500000000000000000", gasLimit: "447000" },
    });
  });

  it("claims the periodic rewards to the withdrawal address without restaking", async () => {
    const { posts } = renderPage("/rewards", { scenario: "minipool" });
    const card = await screen.findByTestId("claim-periodic", {}, { timeout: 3000 });
    await userEvent.click(within(card).getByRole("button", { name: "Claim" }));
    await confirmIn(dialog(), "Claim");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({ path: "/api/sn/node/claim-rewards", params: { indices: "42,43" } });
  });

  it("claims undelivered rewards for the node address, and withdraws credit as rETH", async () => {
    const one = renderPage("/rewards", { scenario: "minipool" });
    await userEvent.click(within(await screen.findByTestId("claim-unclaimed", {}, { timeout: 3000 })).getByRole("button", { name: "Claim" }));
    await confirmIn(dialog(), "Claim");
    await within(dialog()).findByText("Transaction confirmed");
    expect(one.posts()[0]).toMatchObject({ path: "/api/sn/node/claim-unclaimed-rewards", params: { nodeAddress: DEMO.nodeAddress.toLowerCase() } });
    one.unmount();

    const two = renderPage("/rewards", { scenario: "exits" });
    await userEvent.click(within(await screen.findByTestId("claim-credit", {}, { timeout: 3000 })).getByRole("button", { name: "Withdraw" }));
    expect(await within(dialog()).findByText(/paid as the same value in rETH/)).toBeInTheDocument();
    await confirmIn(dialog(), "Withdraw");
    await within(dialog()).findByText("Transaction confirmed");
    expect(two.posts()[0]).toMatchObject({ path: "/api/sn/node/withdraw-credit", params: { amountWei: "4000000000000000000" } });
  });

  it("warns when rewards are paid to the hot wallet, and offers RPL management only in Advanced mode", async () => {
    renderPage("/rewards", { scenario: "mixed" });
    expect(await screen.findByText("Rewards go to the node wallet", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage RPL" })).toBeNull();
    expect(screen.getByText("Switch to Advanced mode to stake, unstake or withdraw RPL.")).toBeInTheDocument();
  });

  it("leaves out sources with nothing in them", async () => {
    renderPage("/rewards", {
      scenario: "minipool",
      reads: {
        "node/get-rewards-info": { status: "success", error: "", registered: true, claimedIntervals: [], unclaimedIntervals: [], invalidIntervals: [], rplStake: 0, rplPrice: 0, activeMinipools: 2, activeMegapoolValidators: 0 },
        "minipool/get-distribute-balance-details": { status: "success", error: "", details: [] },
      },
    });
    expect(await screen.findByTestId("claim-unclaimed", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("claim-periodic")).toBeNull();
  });

  it("M1: ETH staked on the node's behalf, with a withdrawal address set, is explained apart and not counted", async () => {
    const node = (await import("../../../api/fixtures")).SCENARIOS.minipool.reads["node/status"] as object;
    renderPage("/rewards", { scenario: "minipool", reads: { "node/status": { ...node, ethOnBehalfBalance: "2000000000000000000" } } });
    expect(await screen.findByTestId("claim-total", {}, { timeout: 3000 })).toHaveTextContent("0.2132 ETH + 36.34 RPL");
    expect(screen.getByText("2 ETH staked on your behalf")).toBeInTheDocument();
    expect(screen.queryByTestId("claim-eth-on-behalf")).toBeNull();
  });
});
