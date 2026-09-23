import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DemoSnError } from "../../api/fixtures";
import { createMockRocketpoolApi, type MockRocketpoolApi, type RocketpoolMockOptions } from "../../api/mock";
import type { CanResponse, SnEnvelope } from "../../api/models";
import { RocketpoolApiProvider } from "../../api/RocketpoolApiProvider";
import { PENDING_STORAGE_KEY, PendingTxProvider, PendingTxStore } from "../pending";
import { TransactionFlow, type TransactionFlowProps } from "../TransactionFlow";

type Props = Partial<TransactionFlowProps<CanResponse>>;

/**
 * A page with a button that opens the flow, and a switch that mounts or
 * unmounts it (like navigating away and back). `store` lets a test keep the
 * pending record across a simulated reload.
 */
function setup(mock: RocketpoolMockOptions | MockRocketpoolApi = {}, props: Props = {}, store?: PendingTxStore) {
  const api = "calls" in mock ? mock : createMockRocketpoolApi({ scenario: "minipool", ...mock });
  const onDone = vi.fn();
  const onClose = vi.fn();
  let setParams!: (p: Record<string, string>) => void;
  function Page() {
    const [open, setOpen] = useState(true);
    const [mounted, setMounted] = useState(true);
    const [params, _setParams] = useState<Record<string, string> | undefined>(undefined);
    setParams = _setParams;
    return (
      <>
        <button onClick={() => setOpen(true)}>Open again</button>
        <button onClick={() => setMounted((m) => !m)}>Toggle page</button>
        {mounted && (
          <TransactionFlow
            open={open}
            title="Distribute your fee distributor"
            summary="Sends the ETH in your fee distributor: your share to your withdrawal address."
            tx={{ canRoute: "node/can-distribute", route: "node/distribute", ...(params ? { params } : {}) }}
            confirmLabel="Distribute"
            armDelayMs={0}
            onDone={onDone}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
            {...props}
          />
        )}
      </>
    );
  }
  const utils = render(
    <RocketpoolApiProvider api={api}>
      <PendingTxProvider store={store}>
        <Page />
      </PendingTxProvider>
    </RocketpoolApiProvider>,
  );
  const posts = () => api.calls.filter((c) => c.method === "POST");
  const waits = () => api.calls.filter((c) => c.path === "/api/sn/wait");
  return { api, onDone, onClose, posts, waits, setParams: (p: Record<string, string>) => act(() => setParams(p)), ...utils };
}

const confirmButton = () => screen.getByRole("button", { name: "Distribute" });
const reopen = () => userEvent.click(screen.getByRole("button", { name: "Open again" }));
const togglePage = () => userEvent.click(screen.getByRole("button", { name: "Toggle page" }));

/** snPost that waits until released (a slow node). */
function slowPosts(api: MockRocketpoolApi) {
  const releases: Array<() => void> = [];
  const realPost = api.snPost.bind(api);
  api.snPost = async <T extends SnEnvelope>(route: string, body?: Record<string, string | number | boolean>) => {
    await new Promise<void>((r) => releases.push(r));
    return realPost<T>(route, body);
  };
  return async () => {
    await act(async () => releases.shift()?.());
  };
}

describe("TransactionFlow", () => {
  it("checks, shows the plain summary and the fee, sends only on confirm, waits, and links the explorer", async () => {
    const { api, onDone, posts } = setup({}, { tx: { canRoute: "minipool/can-refund", route: "minipool/refund", params: { address: "0xabc" } } });
    expect(screen.getByText(/Checking with Rocket Pool/)).toBeInTheDocument();
    const fee = await screen.findByTestId("tx-fee");
    // 145,000 gas × (0.85 + 1) gwei = 0.00026825 ETH; at most 217,500 × (2 × 0.85 + 1) gwei = 0.00058725 ETH (costs round up)
    expect(within(fee).getByText("about 0.000269 ETH")).toBeInTheDocument();
    expect(within(fee).getByText("0.000588 ETH")).toBeInTheDocument();
    // The numbers behind it: the same ones go into the request.
    const row = (label: string) => within(fee).getByText(label).nextElementSibling?.textContent;
    expect(row("Current base fee")).toBe("0.85 gwei");
    expect(row("Tip for the block builder")).toBe("1 gwei");
    expect(row("Max fee per gas")).toBe("2.7 gwei");
    expect(row("Gas limit")).toBe("217,500");
    expect(screen.getByText(/Sends the ETH in your fee distributor/)).toBeInTheDocument();
    expect(screen.getByText("Nothing is sent until you press Distribute.")).toBeInTheDocument();
    expect(posts()).toHaveLength(0);

    await userEvent.click(confirmButton());
    expect(await screen.findByText("Transaction confirmed")).toBeInTheDocument();
    expect(posts()).toEqual([
      { method: "POST", path: "/api/sn/minipool/refund", params: { address: "0xabc", maxFee: "2.7", maxPrioFee: "1", gasLimit: "217500" } },
    ]);
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /api/sn/minipool/can-refund",
      "GET /api/sn/service/get-gas-price-from-latest-block",
      "POST /api/sn/minipool/refund",
      "GET /api/sn/wait",
    ]);
    expect(api.calls[0].params).toEqual({ address: "0xabc" });
    const hash = api.calls[3].params.txHash as string;
    expect(screen.getByRole("link", { name: /View the transaction on Etherscan/ })).toHaveAttribute("href", `https://etherscan.io/tx/${hash}`);
    expect(onDone).toHaveBeenCalledWith(hash);
    // Focus moved to the outcome, not left on a button that is gone.
    expect(screen.getByText("Transaction confirmed").closest("[tabindex='-1']")).toHaveFocus();
  });

  it("shows the waiting state with the explorer link while the tx is being mined", async () => {
    setup({ waitMs: 60_000 });
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText(/Sent. Waiting for it to be included/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Etherscan/ })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/etherscan\.io\/tx\/0x[0-9a-f]{64}$/));
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  });

  it("sends once, however fast the confirm button is clicked", async () => {
    const { posts } = setup({ latencyMs: 20, waitMs: 60_000 });
    const button = await screen.findByRole("button", { name: "Distribute" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await screen.findByText(/Sent. Waiting/);
    expect(posts()).toHaveLength(1);
  });

  it("keeps confirm disabled for a moment after the summary appears, and says why", async () => {
    const { posts } = setup({}, { armDelayMs: 300 });
    const button = await screen.findByRole("button", { name: "Distribute" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Confirm becomes available in a moment.");
    fireEvent.click(button);
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(confirmButton()).toBeEnabled(), { timeout: 2000 });
  });

  it("can't be closed while the request is on its way", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    const release = slowPosts(api);
    const { onClose } = setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("Sending…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    await release();
    expect(await screen.findByText(/Sent. Waiting/)).toBeInTheDocument();
  });

  it("an irreversible action needs the typed confirmation", async () => {
    const { posts } = setup({}, { requireText: "EXIT", tone: "danger", confirmLabel: "Exit validator" });
    const button = await screen.findByRole("button", { name: "Exit validator" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Type EXIT above to enable Exit validator.");
    await userEvent.type(screen.getByLabelText(/to confirm/), "exit");
    expect(button).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/to confirm/));
    await userEvent.type(screen.getByLabelText(/to confirm/), "EXIT");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await screen.findByText("Transaction confirmed");
    expect(posts()).toHaveLength(1);
  });

  describe("C1: never a second send for the same action", () => {
    it("closing and reopening during the send shows the send, not a new Confirm", async () => {
      const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
      const release = slowPosts(api);
      const { posts } = setup(api);
      await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
      await screen.findByText("Sending…");
      // The parent closes it anyway (e.g. its own state changed) and the owner reopens it.
      await togglePage();
      await togglePage();
      expect(await screen.findByText("Sending…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
      await release();
      expect(await screen.findByText(/Sent. Waiting/)).toBeInTheDocument(); // the answer was recorded although the first dialog is gone
      expect(posts()).toHaveLength(1);
    });

    it("leaving the page while waiting and coming back shows the same pending tx", async () => {
      const { posts, waits } = setup({ waitMs: 60_000 });
      await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
      await screen.findByText(/Sent. Waiting/);
      await togglePage();
      await togglePage();
      expect(await screen.findByText(/Sent. Waiting/)).toBeInTheDocument();
      expect(screen.getByText(/started earlier/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
      expect(posts()).toHaveLength(1);
      expect(waits()).toHaveLength(1); // still the one wait
    });

    it("an unclear send stays locked after closing, and after a reload", async () => {
      const api = createMockRocketpoolApi({ scenario: "minipool", failures: { "node/distribute": "unreachable" } });
      const first = setup(api);
      await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
      expect(await screen.findByText("We don't know if it was sent")).toBeInTheDocument();
      expect(screen.getByText(/Don't try again yet/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      await reopen();
      expect(screen.getByText("We don't know if it was sent")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
      first.unmount();

      // Reload: a new app on the same browser storage.
      expect(localStorage.getItem(PENDING_STORAGE_KEY)).toContain('"state":"unknown"');
      const again = setup(createMockRocketpoolApi({ scenario: "minipool" }));
      expect(await screen.findByText("We don't know if it was sent")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
      expect(again.api.calls.filter((c) => c.path.endsWith("can-distribute"))).toHaveLength(0);
    });

    it("a reload during the wait resumes following the same hash", async () => {
      const first = setup({ waitMs: 60_000 });
      await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
      await screen.findByText(/Sent. Waiting/);
      const hash = first.waits()[0].params.txHash;
      first.unmount();

      const again = setup({ waitMs: 5 });
      expect(await screen.findByText("Transaction confirmed")).toBeInTheDocument();
      expect(again.waits().map((c) => c.params.txHash)).toEqual([hash]);
      expect(again.posts()).toHaveLength(0);
    });

    it("the same action from a second dialog shows the pending one", async () => {
      const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
      const store = new PendingTxStore({ api, storage: null });
      function Two() {
        return (
          <>
            {(["First", "Second"] as const).map((name) => (
              <TransactionFlow
                key={name}
                open
                title={name}
                summary={name}
                tx={{ canRoute: "node/can-distribute", route: "node/distribute" }}
                confirmLabel={`Confirm ${name}`}
                armDelayMs={0}
                onClose={() => {}}
              />
            ))}
          </>
        );
      }
      render(
        <RocketpoolApiProvider api={api}>
          <PendingTxProvider store={store}>
            <Two />
          </PendingTxProvider>
        </RocketpoolApiProvider>,
      );
      const first = await screen.findByRole("button", { name: "Confirm First" });
      await screen.findByRole("button", { name: "Confirm Second" });
      await userEvent.click(first);
      await screen.findAllByText(/Sent. Waiting/);
      // The second dialog had a ready Confirm; pressing it now must not send.
      const second = screen.queryByRole("button", { name: "Confirm Second" });
      if (second) await userEvent.click(second);
      expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    });

    it("calls onDone when the tx is mined, even if the dialog was closed meanwhile", async () => {
      const { onDone } = setup({ waitMs: 50 });
      await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
      await screen.findByText(/Sent. Waiting/);
      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    });
  });

  it("I1: sends exactly the parameters that were checked, not later ones", async () => {
    const { posts, setParams, api } = setup({}, {});
    setParams({ amountWei: "1" });
    await reopen(); // no-op while open; the check already ran with no params
    await screen.findByRole("button", { name: "Distribute" });
    // Re-check with amount 1, then the page changes the amount before confirm.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await reopen();
    await screen.findByRole("button", { name: "Distribute" });
    expect(api.calls.filter((c) => c.path.endsWith("can-distribute")).at(-1)?.params).toEqual({ amountWei: "1" });
    setParams({ amountWei: "999" });
    await userEvent.click(confirmButton());
    await screen.findByText("Transaction confirmed");
    expect(posts()[0].params).toMatchObject({ amountWei: "1" });
  });

  it("I2: a summary older than a minute is checked again before sending", async () => {
    const { posts, api } = setup({}, { maxQuoteAgeMs: 50 });
    await screen.findByRole("button", { name: "Distribute" });
    await act(() => new Promise((r) => setTimeout(r, 80)));
    await userEvent.click(confirmButton());
    expect(await screen.findByText(/more than a minute old, so it was checked again/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    expect(api.calls.filter((c) => c.path.endsWith("can-distribute"))).toHaveLength(2);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText("Transaction confirmed");
    expect(posts()).toHaveLength(1);
  });

  it("I4: a deposit is judged by canDeposit only (canUseCredit false is fine)", async () => {
    setup(
      { reads: { "node/can-deposit": { status: "success", error: "", canDeposit: true, canUseCredit: false, gasLimits: { estimated: 1_500_000, safe: 2_250_000 } } } },
      { tx: { canRoute: "node/can-deposit", route: "node/deposit", params: { amountWei: "4000000000000000000" } } },
    );
    expect(await screen.findByTestId("tx-fee")).toBeInTheDocument();
  });

  it("stops when the route's own flag is false, with Smartnode's reason in plain words", async () => {
    const first = setup({
      reads: { "node/can-deposit": { status: "success", error: "", canDeposit: false, insufficientBalance: true, gasLimits: { estimated: 0, safe: 0 } } },
    }, { tx: { canRoute: "node/can-deposit", route: "node/deposit" } });
    expect(await screen.findByText("This can't be done right now")).toBeInTheDocument();
    expect(screen.getByText("The node wallet doesn't have enough ETH for this.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
    expect(first.posts()).toHaveLength(0);
  });

  it("uses the page's own reason and details from the check", async () => {
    setup(
      { reads: { "node/can-distribute": { status: "success", error: "", canDistribute: true, noBalance: true, gasLimits: { estimated: 1, safe: 1 } } } },
      { tx: { canRoute: "node/can-distribute", route: "node/distribute", blockedReason: (c) => (c.noBalance ? "There is nothing to distribute yet." : null) } },
    );
    expect(await screen.findByText("There is nothing to distribute yet.")).toBeInTheDocument();
  });

  it("shows details from the check next to the fee", async () => {
    setup({}, { tx: { canRoute: "node/can-distribute", route: "node/distribute", details: () => <p>You receive about 0.05 ETH.</p> } });
    expect(await screen.findByText("You receive about 0.05 ETH.")).toBeInTheDocument();
  });

  it("never sends without a fee estimate", async () => {
    const { posts } = setup({ reads: { "node/can-distribute": { status: "success", error: "", canDistribute: true } } });
    expect(await screen.findByText(/network fee could not be estimated/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("a failed check explains and can check again", async () => {
    const api = createMockRocketpoolApi({ scenario: "daemon-failed" });
    setup(api);
    expect(await screen.findByText("Could not check this transaction")).toBeInTheDocument();
    expect(screen.getByText("The Rocket Pool daemon is not reachable (it may still be starting).")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Could not check this transaction")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === "/api/sn/node/can-distribute")).toHaveLength(2);
  });

  it("M1: a Smartnode refusal was most likely not sent; a backend refusal certainly not", async () => {
    const api = createMockRocketpoolApi({
      scenario: "minipool",
      failures: { "node/distribute": new DemoSnError(500, "Insufficient ETH balance to pay for the transaction") },
    });
    const { posts } = setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("Insufficient ETH balance to pay for the transaction.")).toBeInTheDocument();
    expect(screen.getByText("It was most likely not sent, and no fee was paid for it.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText("Not sent");
    expect(posts()).toHaveLength(2);
  });

  it("M1: a request the backend refused was certainly not sent", async () => {
    setup({ failures: { "node/distribute": new DemoSnError(403, "Missing X-Avado-Request header") } });
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("Nothing was sent and no fee was paid.")).toBeInTheDocument();
  });

  it("an answer without a tx hash is treated as unclear", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    api.snPost = async <T extends SnEnvelope>() => ({ status: "success", error: "" }) as T;
    setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("We don't know if it was sent")).toBeInTheDocument();
  });

  it("a mined but failed tx says so, with the link and that the fee was paid", async () => {
    const { onDone } = setup({ txOutcome: "revert" });
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("The transaction failed")).toBeInTheDocument();
    expect(screen.getByText(/network fee for it was still paid/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Etherscan/ })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("I6: losing track while waiting re-checks the same tx with one wait at a time, never sends again", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool", failures: { wait: "timeout" } });
    const signals: AbortSignal[] = [];
    const snGet = api.snGet.bind(api);
    api.snGet = ((route: string, params?: Record<string, string>, opts?: { signal?: AbortSignal }) => {
      if (route === "wait" && opts?.signal) signals.push(opts.signal);
      return snGet(route, params, opts);
    }) as typeof api.snGet;
    const { posts, waits } = setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("Sent, but the result isn't known yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check the transaction again" }));
    await waitFor(() => expect(waits()).toHaveLength(2));
    expect(await screen.findByText("Sent, but the result isn't known yet")).toBeInTheDocument();
    const hashes = waits().map((c) => c.params.txHash);
    expect(hashes[1]).toBe(hashes[0]);
    expect(posts()).toHaveLength(1);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });

  it("reads the hash from the route's own field", async () => {
    const { api } = setup(
      { reads: { "node/can-stake-rpl": { status: "success", error: "", canStake: true, gasLimits: { estimated: 90_000, safe: 135_000 } } } },
      { tx: { canRoute: "node/can-stake-rpl", route: "node/stake-rpl", params: { amountWei: "1000000000000000000" }, txHashField: "stakeTxHash" } },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText("Transaction confirmed");
    expect(api.calls.at(-1)?.path).toBe("/api/sn/wait");
  });

  it("after a finished tx, opening again starts a fresh check", async () => {
    const { posts } = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText("Transaction confirmed");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await reopen();
    expect(await screen.findByRole("button", { name: "Distribute" })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });
});
