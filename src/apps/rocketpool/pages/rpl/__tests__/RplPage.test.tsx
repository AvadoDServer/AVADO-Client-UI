import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { confirmIn, renderPage } from "../../__tests__/renderPage";

const dialog = () => screen.getByRole("dialog");
const section = (title: string) => screen.getByRole("heading", { name: title }).closest("div.relative") as HTMLElement;

describe("RPL page", () => {
  it("stakes in two confirmed steps: allow exactly the amount, then stake", async () => {
    const { posts } = renderPage("/rpl", { scenario: "minipool" }, { advanced: true });
    await screen.findByTestId("rpl-summary", {}, { timeout: 3000 });
    const card = section("Stake RPL on your megapool");
    await userEvent.type(within(card).getByLabelText("RPL to stake"), "10");
    await userEvent.click(within(card).getByRole("button", { name: "Stake…" }));
    expect(await screen.findByRole("dialog", { name: "Step 1 of 2: allow Rocket Pool to take 10 RPL" })).toBeInTheDocument();
    await confirmIn(dialog(), "Allow");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()).toHaveLength(1);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
    // Step 2 needs its own confirm.
    expect(await screen.findByRole("dialog", { name: "Step 2 of 2: stake 10 RPL" })).toBeInTheDocument();
    await within(dialog()).findByTestId("tx-fee");
    expect(posts()).toHaveLength(1);
    await confirmIn(dialog(), "Stake");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts().map((p) => [p.path, p.params.amountWei])).toEqual([
      ["/api/sn/node/stake-rpl-approve-rpl", "10000000000000000000"],
      ["/api/sn/node/stake-rpl", "10000000000000000000"],
    ]);
  });

  it("skips the approval when Rocket Pool may already take that much, and stops after a cancelled approval", async () => {
    const one = renderPage("/rpl", { scenario: "minipool", reads: { "node/stake-rpl-allowance": { status: "success", error: "", allowance: "50000000000000000000" } } }, { advanced: true });
    await screen.findByTestId("rpl-summary", {}, { timeout: 3000 });
    await userEvent.type(within(section("Stake RPL on your megapool")).getByLabelText("RPL to stake"), "12.5");
    await userEvent.click(within(section("Stake RPL on your megapool")).getByRole("button", { name: "Stake…" }));
    expect(await screen.findByRole("dialog", { name: "Stake 12.5 RPL" })).toBeInTheDocument();
    await confirmIn(dialog(), "Stake");
    await within(dialog()).findByText("Transaction confirmed");
    expect(one.posts().map((p) => p.path)).toEqual(["/api/sn/node/stake-rpl"]);
    one.unmount();

    const two = renderPage("/rpl", { scenario: "minipool" }, { advanced: true });
    await screen.findByTestId("rpl-summary", {}, { timeout: 3000 });
    await userEvent.type(within(section("Stake RPL on your megapool")).getByLabelText("RPL to stake"), "1");
    await userEvent.click(within(section("Stake RPL on your megapool")).getByRole("button", { name: "Stake…" }));
    await screen.findByRole("dialog", { name: /Step 1 of 2/ });
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(two.posts()).toHaveLength(0);
  });

  it("refuses more RPL than the wallet has", async () => {
    renderPage("/rpl", { scenario: "minipool" }, { advanced: true });
    await screen.findByTestId("rpl-summary", {}, { timeout: 3000 });
    const card = section("Stake RPL on your megapool");
    await userEvent.type(within(card).getByLabelText("RPL to stake"), "13");
    expect(within(card).getByText("That is more than is available.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Stake…" })).toBeDisabled();
  });

  it("legacy RPL: offers only what is above the 15% minimum, and blocks an amount below it", async () => {
    const { posts } = renderPage("/rpl", { scenario: "exits" }, { advanced: true });
    await screen.findByTestId("rpl-summary", {}, { timeout: 3000 });
    const card = section("Unstake legacy RPL");
    expect(within(card).getByText("Up to 487.5 RPL (keeping the 412.5 RPL minimum)")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Max" }));
    expect(within(card).getByLabelText("Legacy RPL to unstake")).toHaveValue("487.5");
    await userEvent.click(within(card).getByRole("button", { name: "Unstake…" }));
    // The exits node's check says the minimum would be crossed.
    expect(await within(dialog()).findByText(/less legacy RPL staked than your minipools need \(15% of the ETH they borrowed\)/)).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Unstake" })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("unstakes legacy RPL when the check allows it", async () => {
    const { posts } = renderPage("/rpl", { scenario: "minipool" }, { advanced: true });
    await screen.findByTestId("rpl-summary", {}, { timeout: 3000 });
    const card = section("Unstake legacy RPL");
    await userEvent.type(within(card).getByLabelText("Legacy RPL to unstake"), "100");
    await userEvent.click(within(card).getByRole("button", { name: "Unstake…" }));
    await confirmIn(dialog(), "Unstake");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({ path: "/api/sn/node/unstake-legacy-rpl", params: { amountWei: "100000000000000000000" } });
  });

  it("withdraws RPL once the unstaking period is over", async () => {
    const { posts } = renderPage("/rpl", { scenario: "exits" }, { advanced: true });
    const card = await screen.findByTestId("rpl-unstaking", {}, { timeout: 3000 });
    expect(within(card).getByText(/300 RPL has finished unstaking/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Withdraw RPL" }));
    await confirmIn(dialog(), "Withdraw");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0].path).toBe("/api/sn/node/withdraw-rpl");
  });

  it("says when unstaking RPL can be withdrawn", async () => {
    renderPage(
      "/rpl",
      {
        scenario: "exits",
        reads: {
          "node/status": {
            ...(await import("../../../api/fixtures")).SCENARIOS.exits.reads["node/status"] as object,
            lastRPLUnstakeTime: "2026-09-20T10:00:00Z",
          },
        },
      },
      { advanced: true },
    );
    const card = await screen.findByTestId("rpl-unstaking", {}, { timeout: 3000 });
    expect(within(card).getByText(/300 RPL is unstaking. You can withdraw it from/)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Withdraw RPL" })).toBeNull();
  });
});
