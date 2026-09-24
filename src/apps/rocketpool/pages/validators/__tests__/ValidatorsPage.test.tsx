import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEMO } from "../../../api/fixtures";
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
    const confirm = within(d).getByRole("button", { name: "Exit minipool" });
    await userEvent.type(within(d).getByLabelText(/to confirm/), "wrong1");
    await userEvent.click(confirm);
    expect(posts().filter((p) => p.path.startsWith("/api/sn/"))).toHaveLength(0);
    await userEvent.clear(within(d).getByLabelText(/to confirm/));
    await userEvent.type(within(d).getByLabelText(/to confirm/), code);
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    expect(await within(dialog()).findByText("Exit requested")).toBeInTheDocument();
    expect(posts()).toEqual([{ method: "POST", path: "/api/sn/minipool/exit", params: { address: DEMO.minipoolA.toLowerCase() } }]);
    expect(api.calls.some((c) => c.path === "/api/sn/wait")).toBe(false);
  });

  it("closes an exited minipool, bundled with the fee distributor, and counts both transactions in the fee", async () => {
    const { posts } = renderPage("/validators", { scenario: "exits" });
    const d = await card(`minipool-${DEMO.minipoolD.toLowerCase()}`);
    expect(within(d).getByText("Exited, ready to close")).toBeInTheDocument();
    expect(within(d).queryByRole("button", { name: "Exit…" })).toBeNull();
    await userEvent.click(within(d).getByRole("button", { name: "Close minipool" }));
    const box = await screen.findByRole("dialog");
    expect(within(box).getByText(/Your fee distributor also holds ETH/)).toBeInTheDocument();
    expect(await within(box).findByText(/You receive about/)).toHaveTextContent("You receive about 8.0311 ETH of the 32.0514 ETH in the minipool.");
    const fee = within(box).getByTestId("tx-fee");
    expect(within(fee).getByText("Second transaction (close)").nextElementSibling).toHaveTextContent("600,000 gas");
    expect(within(fee).getByText("Gas limit").nextElementSibling).toHaveTextContent("273,000");
    await confirmIn(box, "Close minipool");
    expect(await within(dialog()).findByText("Transaction confirmed")).toBeInTheDocument();
    expect(posts()[0]).toMatchObject({ path: "/api/sn/minipool/close", params: { address: DEMO.minipoolD.toLowerCase(), bundle: "true", gasLimit: "273000" } });
  });

  it("won't close a minipool whose balance is below what it borrowed", async () => {
    const { posts } = renderPage("/validators", {
      scenario: "exits",
      reads: {
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

  it("adds a validator: the exact bond, a check, then a deposit that saves the keys and asks for a key check", async () => {
    const { posts, api } = renderPage("/validators", { scenario: "mixed" });
    const mega = await card("megapool");
    await userEvent.click(within(mega).getByRole("button", { name: "Add a validator" }));
    const box = await screen.findByRole("dialog", { name: "Add validators" });
    // Active 1, bonded 8 + queued 4; the demo requirement for 2 validators is 8 ETH → the 1 ETH minimum.
    expect(await within(box).findByText("Bond to deposit")).toBeInTheDocument();
    expect(within(box).getByText("Bond to deposit").nextElementSibling).toHaveTextContent("1 ETH");
    expect(api.calls.find((c) => c.path === "/api/sn/node/get-bond-requirement")?.params).toEqual({ numValidators: 2 });
    expect(within(box).getByText("Not enough ETH yet")).toBeInTheDocument();
    await userEvent.click(within(box).getByRole("button", { name: "Review" }));
    const flow = await screen.findByRole("dialog", { name: "Add a validator" });
    await confirmIn(flow, "Deposit");
    await within(flow).findByText("Transaction confirmed");
    expect(posts()[0]).toMatchObject({
      path: "/api/sn/node/deposit",
      params: { amountWei: "1000000000000000000", minFee: "0", salt: "0", expressTickets: 1, count: 1, useCreditBalance: "false", submit: "true" },
    });
    expect(posts().some((p) => p.path === "/api/avado/reconcile/run")).toBe(true);
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
