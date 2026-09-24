import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO, SCENARIOS } from "../../../api/fixtures";
import { confirmIn, renderPage } from "../../__tests__/renderPage";

const card = (testId: string) => screen.findByTestId(testId);
const dialog = () => screen.getByRole("dialog");

describe("Validators page", () => {
  it("lists the minipools as cards with their state and plain facts", async () => {
    renderPage("/validators", { scenario: "minipool" });
    const a = await card(`minipool-${DEMO.minipoolA.toLowerCase()}`);
    expect(within(a).getByText("Staking")).toBeInTheDocument();
    expect(within(a).getByText("Your bond").nextElementSibling).toHaveTextContent("8 ETH");
    expect(within(a).getByText("Borrowed from Rocket Pool").nextElementSibling).toHaveTextContent("24 ETH");
    expect(within(a).getByText("Commission").nextElementSibling).toHaveTextContent("14%");
    expect(within(a).getByRole("link", { name: /Index 612345/ })).toHaveAttribute("href", `https://beaconcha.in/validator/0x${DEMO.pubkeyA}`);
    expect(within(a).getByRole("button", { name: "Exit…" })).toBeInTheDocument();
    expect(within(a).queryByRole("button", { name: "Close minipool" })).toBeNull();
    // No megapool yet: the way to add one.
    expect(screen.getByRole("button", { name: "Add a validator" })).toBeInTheDocument();
  });

  it("exits a minipool only after the owner types the address code; it is a signed message, not a transaction", async () => {
    const { posts, api } = renderPage("/validators", { scenario: "minipool" });
    const a = await card(`minipool-${DEMO.minipoolA.toLowerCase()}`);
    await userEvent.click(within(a).getByRole("button", { name: "Exit…" }));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText(/An exit is permanent and can't be undone/)).toBeInTheDocument();
    expect(await within(d).findByTestId("tx-no-fee")).toBeInTheDocument();
    const code = DEMO.minipoolA.slice(-6).toLowerCase();
    expect(code).toMatch(/[a-f]/); // so the upper-case entry below really differs
    const confirm = within(d).getByRole("button", { name: "Exit minipool" });
    await userEvent.type(within(d).getByLabelText(/to confirm/), "wrong1");
    await userEvent.click(confirm);
    expect(posts().filter((p) => p.path.startsWith("/api/sn/"))).toHaveLength(0);
    await userEvent.clear(within(d).getByLabelText(/to confirm/));
    // M4: the code comes from a checksummed address, so any letter case is accepted.
    await userEvent.type(within(d).getByLabelText(/to confirm/), code.toUpperCase());
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    expect(await within(dialog()).findByText("Exit requested")).toBeInTheDocument();
    expect(posts()).toEqual([{ method: "POST", path: "/api/sn/minipool/exit", params: { address: DEMO.minipoolA.toLowerCase() } }]);
    expect(api.calls.some((c) => c.path === "/api/sn/wait")).toBe(false);
  });

  it("I1: with ETH in the fee distributor, closing is two confirmed steps: pay out the distributor, then close without a bundle", async () => {
    const { posts } = renderPage("/validators", { scenario: "exits" });
    const d = await card(`minipool-${DEMO.minipoolD.toLowerCase()}`);
    expect(within(d).getByText("Exited, ready to close")).toBeInTheDocument();
    expect(within(d).queryByRole("button", { name: "Exit…" })).toBeNull();
    expect(within(d).queryByRole("button", { name: "Close in one bundle…" })).toBeNull(); // Advanced only
    await userEvent.click(within(d).getByRole("button", { name: "Close minipool" }));
    expect(await screen.findByRole("dialog", { name: "Step 1 of 2: pay out your fee distributor" })).toBeInTheDocument();
    expect(within(dialog()).getByText(/It is paid out before minipool/)).toBeInTheDocument();
    await confirmIn(dialog(), "Distribute");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()).toHaveLength(1);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));
    // Step 2 needs its own check and confirm; no bundle, so no second transaction in the fee.
    const box = await screen.findByRole("dialog", { name: /Step 2 of 2: close minipool/ });
    expect(await within(box).findByText(/You receive about/)).toHaveTextContent("You receive about 8.0311 ETH of the 32.0514 ETH in the minipool.");
    expect(within(within(box).getByTestId("tx-fee")).queryByText(/Second transaction/)).toBeNull();
    expect(posts()).toHaveLength(1);
    await confirmIn(box, "Close minipool");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts().map((p) => p.path)).toEqual(["/api/sn/node/distribute", "/api/sn/minipool/close"]);
    expect(posts()[1].params).toMatchObject({ address: DEMO.minipoolD.toLowerCase(), bundle: "false", gasLimit: "273000" });
  });

  it("I1: cancelling step 1 ends the close; nothing is sent", async () => {
    const { posts } = renderPage("/validators", { scenario: "exits" });
    const d = await card(`minipool-${DEMO.minipoolD.toLowerCase()}`);
    await userEvent.click(within(d).getByRole("button", { name: "Close minipool" }));
    await screen.findByRole("dialog", { name: "Step 1 of 2: pay out your fee distributor" });
    await userEvent.click(await within(dialog()).findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("I1: Advanced mode offers the one-block bundle, says it is often not included and points to the two-step close", async () => {
    const { posts } = renderPage("/validators", { scenario: "exits" }, { advanced: true });
    const d = await card(`minipool-${DEMO.minipoolD.toLowerCase()}`);
    await userEvent.click(within(d).getByRole("button", { name: "Close in one bundle…" }));
    const box = await screen.findByRole("dialog");
    expect(within(box).getByText(/Bundles are often not included at the normal tip/)).toBeInTheDocument();
    expect(await within(box).findByText(/plus your share of the fee distributor/)).toBeInTheDocument();
    const fee = within(box).getByTestId("tx-fee");
    expect(within(fee).getByText(/^Second transaction \(close\)/).nextElementSibling).toHaveTextContent("600,000 gas");
    await confirmIn(box, "Close in one bundle");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({ path: "/api/sn/minipool/close", params: { bundle: "true", gasLimit: "273000" } });
  });

  it("an empty fee distributor: closing is one step", async () => {
    const node = SCENARIOS.exits.reads["node/status"] as object;
    const { posts } = renderPage("/validators", { scenario: "exits", reads: { "node/status": { ...node, feeDistributorBalance: 0 } } });
    const d = await card(`minipool-${DEMO.minipoolD.toLowerCase()}`);
    await userEvent.click(within(d).getByRole("button", { name: "Close minipool" }));
    await confirmIn(await screen.findByRole("dialog", { name: /^Close minipool/ }), "Close minipool");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts().map((p) => [p.path, p.params.bundle])).toEqual([["/api/sn/minipool/close", "false"]]);
  });

  it("won't close a minipool whose balance is below what it borrowed", async () => {
    const { posts } = renderPage("/validators", {
      scenario: "exits",
      reads: {
        "node/status": { ...(SCENARIOS.exits.reads["node/status"] as object), feeDistributorBalance: 0 },
        "minipool/get-minipool-close-details-for-node": {
          status: "success",
          error: "",
          expressTicketsProvisioned: true,
          isFeeDistributorInitialized: true,
          details: [
            {
              address: DEMO.minipoolD,
              isFinalized: false,
              minipoolStatus: "Staking",
              minipoolVersion: 3,
              distributed: false,
              canClose: true,
              balance: "20000000000000000000",
              refund: 0,
              userDepositBalance: "24000000000000000000",
              beaconState: "withdrawal_done",
              nodeShare: 0,
              gasLimits: { estimated: 1, safe: 1 },
            },
          ],
        },
      },
    });
    const d = await card(`minipool-${DEMO.minipoolD.toLowerCase()}`);
    await userEvent.click(within(d).getByRole("button", { name: "Close minipool" }));
    expect(await within(dialog()).findByText(/lower than the ETH it borrowed/)).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Close minipool" })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("distributes a minipool's rewards with the node's share in the summary", async () => {
    const { posts } = renderPage("/validators", { scenario: "minipool" });
    const a = await card(`minipool-${DEMO.minipoolA.toLowerCase()}`);
    await userEvent.click(within(a).getByRole("button", { name: "Distribute rewards" }));
    expect(await within(dialog()).findByText(/You receive about/)).toHaveTextContent("0.0187 ETH");
    await confirmIn(dialog(), "Distribute");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({ path: "/api/sn/minipool/distribute-balance", params: { address: DEMO.minipoolA.toLowerCase(), gasLimit: "181500" } });
  });

  it("shows the megapool, exits a validator after its index is typed, and takes a queued one out of the queue", async () => {
    const { posts } = renderPage("/validators", { scenario: "mixed" });
    const mega = await card("megapool");
    expect(within(mega).getByText("Validators").nextElementSibling).toHaveTextContent("1 active of 2");
    const v0 = screen.getByTestId("megapool-validator-0");
    expect(within(v0).getByText("Active")).toBeInTheDocument();
    await userEvent.click(within(v0).getByRole("button", { name: "Exit…" }));
    await within(dialog()).findByTestId("tx-no-fee");
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "2104551");
    await confirmIn(dialog(), "Exit validator");
    await within(dialog()).findByText("Exit requested");
    expect(posts()).toEqual([{ method: "POST", path: "/api/sn/megapool/exit-validator", params: { validatorId: "0" } }]);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));

    const v1 = screen.getByTestId("megapool-validator-1");
    expect(within(v1).getByText("In the queue (position 214)")).toBeInTheDocument();
    expect(within(v1).queryByRole("button", { name: "Exit…" })).toBeNull();
    await userEvent.click(within(v1).getByRole("button", { name: "Leave the queue…" }));
    await confirmIn(dialog(), "Leave the queue");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[1]).toMatchObject({ path: "/api/sn/megapool/exit-queue", params: { validatorIndex: "1", gasLimit: "132000" } });
  });

  it("a megapool with a debt: repay it (exact amount), claim the refund, no new validators, no distribute while exiting", async () => {
    const { posts } = renderPage("/validators", { scenario: "exits" });
    const mega = await card("megapool");
    expect(within(mega).getByText("Your megapool owes 0.05 ETH")).toBeInTheDocument();
    expect(within(mega).getByRole("button", { name: "Add a validator" })).toBeDisabled();
    expect(within(screen.getByTestId("megapool-validator-1")).getByText("Exiting")).toBeInTheDocument();
    expect(within(screen.getByTestId("megapool-validator-1")).queryByRole("button", { name: "Exit…" })).toBeNull();

    await userEvent.click(within(mega).getByRole("button", { name: "Distribute rewards" }));
    expect(await within(dialog()).findByText(/can't be distributed while 1 validator is exiting and 1 validator is finishing an exit/)).toBeInTheDocument();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));

    await userEvent.click(within(mega).getByRole("button", { name: "Repay debt" }));
    await confirmIn(dialog(), "Repay debt");
    await within(dialog()).findByText("Transaction confirmed");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Done" }));

    await userEvent.click(within(mega).getByRole("button", { name: "Claim refund" }));
    await confirmIn(dialog(), "Claim refund");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts().map((p) => [p.path, p.params.amountWei])).toEqual([
      ["/api/sn/megapool/repay-debt", "50000000000000000"],
      ["/api/sn/megapool/claim-refund", undefined],
    ]);
  });

  it("offers to set up express tickets when the minipools' tickets aren't provisioned", async () => {
    const { posts } = renderPage("/validators", { scenario: "exits" });
    await userEvent.click(await screen.findByRole("button", { name: "Set them up now" }));
    await confirmIn(dialog(), "Set up tickets");
    await within(dialog()).findByText("Transaction confirmed");
    expect(posts()[0].path).toBe("/api/sn/node/provision-express-tickets");
  });

  it("adds a validator with the setup wizard's deposit form: the exact bond, and blocked while the wallet is short", async () => {
    const { posts, api } = renderPage("/validators", { scenario: "mixed" });
    const mega = await card("megapool");
    await userEvent.click(within(mega).getByRole("button", { name: "Add a validator" }));
    const box = await screen.findByRole("dialog", { name: "Add validators" });
    // Active 1, bonded 8 + queued 4; the demo requirement for 2 validators is 8 ETH → the 1 ETH minimum.
    const plan = await within(box).findByTestId("deposit-plan", {}, { timeout: 3000 });
    expect(within(plan).getByText("Your bond").nextElementSibling).toHaveTextContent("1 ETH");
    expect(api.calls.find((c) => c.path === "/api/sn/node/get-bond-requirement")?.params).toEqual({ numValidators: 2 });
    expect(within(box).getByText("Not possible right now")).toBeInTheDocument();
    expect(within(box).getByText(/doesn't have enough ETH for this bond: it has 0.0061 ETH/)).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Create 1 validator" })).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });

  it("adds a validator: a check, then a deposit with the one fixed parameter set that asks for a key check", async () => {
    const enough = { ...SCENARIOS.mixed.reads["node/can-deposit"] as object, canDeposit: true, insufficientBalance: false, nodeBalance: "5000000000000000000", gasLimits: { estimated: 1_210_000, safe: 1_815_000 } };
    const { posts } = renderPage("/validators", { scenario: "mixed", reads: { "node/can-deposit": enough } });
    const mega = await card("megapool");
    await userEvent.click(within(mega).getByRole("button", { name: "Add a validator" }));
    const box = await screen.findByRole("dialog", { name: "Add validators" });
    const create = await within(box).findByRole("button", { name: "Create 1 validator" });
    await waitFor(() => expect(create).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(create);
    const flow = await screen.findByRole("dialog", { name: "Create 1 validator" });
    expect(within(flow).getByText(/network fee below is paid from the node wallet on top of the bond/)).toBeInTheDocument();
    await confirmIn(flow, "Create validators");
    await within(flow).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({
      path: "/api/sn/node/deposit",
      params: { amountWei: "1000000000000000000", minFee: "0", salt: "0", expressTickets: "1", count: "1", useCreditBalance: "false", submit: "true" },
    });
    expect(posts().some((p) => p.path === "/api/avado/reconcile/run")).toBe(true);
  });

  it("a megapool with a debt can't add validators through the form either", async () => {
    const { posts } = renderPage("/validators", {
      scenario: "mixed",
      reads: { "node/can-deposit": { ...SCENARIOS.mixed.reads["node/can-deposit"] as object, canDeposit: false, insufficientBalance: true, nodeHasDebt: true } },
    });
    const mega = await card("megapool");
    await userEvent.click(within(mega).getByRole("button", { name: "Add a validator" }));
    const box = await screen.findByRole("dialog", { name: "Add validators" });
    expect(await within(box).findByText(/Your megapool has a debt. Repay it first/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Create 1 validator" })).toBeDisabled();
    expect(posts()).toHaveLength(0);
  });

  it("asks to set up the node when there is no wallet, and waits when the daemon is down", async () => {
    renderPage("/validators", { scenario: "fresh" });
    expect(await screen.findByText("Your node isn't set up yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up your node" })).toHaveAttribute("href", "/setup");
  });

  it("says Rocket Pool isn't ready while the daemon is stopped, and reads nothing from it", async () => {
    const { api } = renderPage("/validators", { scenario: "daemon-failed" });
    expect(await screen.findByText("Rocket Pool isn't ready yet")).toBeInTheDocument();
    expect(api.calls.some((c) => c.path.startsWith("/api/sn/"))).toBe(false);
  });
});
