import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DemoSnError } from "../../api/fixtures";
import { createMockRocketpoolApi, type MockRocketpoolApi, type RocketpoolMockOptions } from "../../api/mock";
import type { CanResponse, SnEnvelope } from "../../api/models";
import { RocketpoolApiProvider } from "../../api/RocketpoolApiProvider";
import { TransactionFlow, type TransactionFlowProps } from "../TransactionFlow";

type Props = Partial<TransactionFlowProps<CanResponse>>;

function setup(mock: RocketpoolMockOptions | MockRocketpoolApi = {}, props: Props = {}) {
  const api = "calls" in mock ? mock : createMockRocketpoolApi({ scenario: "minipool", ...mock });
  const onDone = vi.fn();
  const onClose = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <TransactionFlow
        open={open}
        title="Distribute your fee distributor"
        summary="Sends the ETH in your fee distributor: your share to your withdrawal address."
        tx={{ canRoute: "node/can-distribute", route: "node/distribute" }}
        confirmLabel="Distribute"
        armDelayMs={0}
        onDone={onDone}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        {...props}
      />
    );
  }
  render(
    <RocketpoolApiProvider api={api}>
      <Harness />
    </RocketpoolApiProvider>,
  );
  const posts = () => api.calls.filter((c) => c.method === "POST");
  return { api, onDone, onClose, posts, dialog: () => screen.getByRole("dialog") };
}

const confirmButton = () => screen.getByRole("button", { name: "Distribute" });

describe("TransactionFlow", () => {
  it("checks, shows the plain summary and the fee, sends only on confirm, waits, and links the explorer", async () => {
    const { api, onDone, posts } = setup({}, { tx: { canRoute: "minipool/can-refund", route: "minipool/refund", params: { address: "0xabc" } } });
    expect(screen.getByText(/Checking with Rocket Pool/)).toBeInTheDocument();
    const fee = await screen.findByTestId("tx-fee");
    // 145,000 gas × (0.85 + 1) gwei; at most 217,500 × (2 × 0.85 + 1) gwei
    expect(within(fee).getByText("about 0.000268 ETH")).toBeInTheDocument();
    expect(within(fee).getByText("0.000587 ETH")).toBeInTheDocument();
    expect(within(fee).getByText(/0.85 gwei plus a 1 gwei tip/)).toBeInTheDocument();
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
  });

  it("shows the waiting state with the explorer link while the tx is being mined", async () => {
    setup({ waitMs: 60_000 });
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText(/Sent. Waiting for it to be included/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Etherscan/ })).toHaveAttribute("href", expect.stringMatching(/^https:\/\/etherscan\.io\/tx\/0x[0-9a-f]{64}$/));
    // It can be closed; the transaction continues.
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
    await userEvent.dblClick(button);
    await screen.findByText(/Sent. Waiting/);
    expect(posts()).toHaveLength(1);
  });

  it("keeps confirm disabled for a moment after the summary appears", async () => {
    const { posts } = setup({}, { armDelayMs: 300 });
    const button = await screen.findByRole("button", { name: "Distribute" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(confirmButton()).toBeEnabled(), { timeout: 2000 });
  });

  it("can't be closed while the request is on its way", async () => {
    let release!: () => void;
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    const realPost = api.snPost.bind(api);
    api.snPost = async <T extends SnEnvelope>(route: string, body?: Record<string, string | number | boolean>) => {
      await new Promise<void>((r) => (release = r));
      return realPost<T>(route, body);
    };
    const { onClose } = setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Sending…")).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByText(/Sent. Waiting/)).toBeInTheDocument();
  });

  it("an irreversible action needs the typed confirmation", async () => {
    const { posts } = setup({}, { requireText: "EXIT", tone: "danger", confirmLabel: "Exit validator" });
    const button = await screen.findByRole("button", { name: "Exit validator" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to confirm/), "exit");
    expect(button).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/to confirm/));
    await userEvent.type(screen.getByLabelText(/to confirm/), "EXIT");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await screen.findByText("Transaction confirmed");
    expect(posts()).toHaveLength(1);
  });

  it("stops when Rocket Pool says no (a canX: false flag), or with the page's own reason", async () => {
    const first = setup({ reads: { "node/can-distribute": { status: "success", error: "", canDistribute: false, gasLimits: { estimated: 0, safe: 0 } } } });
    expect(await screen.findByText("This can't be done right now")).toBeInTheDocument();
    expect(screen.getByText("Rocket Pool says this can't be done right now.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
    expect(first.posts()).toHaveLength(0);
    first.onClose.mockReset();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(first.onClose).toHaveBeenCalled();
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

  it("a refused send says nothing was sent, and allows a fresh check and one more send", async () => {
    const api = createMockRocketpoolApi({
      scenario: "minipool",
      failures: { "node/distribute": new DemoSnError(500, "Insufficient ETH balance to pay for the transaction") },
    });
    const { posts } = setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("Insufficient ETH balance to pay for the transaction.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was sent and no fee was paid.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText("Not sent");
    expect(posts()).toHaveLength(2);
  });

  it("an unclear send is never offered again: only Close", async () => {
    const { posts } = setup({ failures: { "node/distribute": "timeout" } });
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("We don't know if it was sent")).toBeInTheDocument();
    expect(screen.getByText(/Don't try again yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it("reopening after an unclear send shows it again instead of offering a second send", async () => {
    function Reopen({ api }: { api: MockRocketpoolApi }) {
      const [open, setOpen] = useState(true);
      return (
        <RocketpoolApiProvider api={api}>
          <button onClick={() => setOpen(true)}>Open again</button>
          <TransactionFlow
            open={open}
            title="Distribute"
            summary="Sends it."
            tx={{ canRoute: "node/can-distribute", route: "node/distribute" }}
            confirmLabel="Distribute"
            armDelayMs={0}
            onClose={() => setOpen(false)}
          />
        </RocketpoolApiProvider>
      );
    }
    const api = createMockRocketpoolApi({ scenario: "minipool", failures: { "node/distribute": "unreachable" } });
    render(<Reopen api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText("We don't know if it was sent");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Open again" }));
    expect(screen.getByText("We don't know if it was sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Distribute" })).not.toBeInTheDocument();
    expect(api.calls.filter((c) => c.path.endsWith("can-distribute"))).toHaveLength(1);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("reopening while a sent tx is pending follows the same hash again", async () => {
    function Reopen({ api }: { api: MockRocketpoolApi }) {
      const [open, setOpen] = useState(true);
      return (
        <RocketpoolApiProvider api={api}>
          <button onClick={() => setOpen(true)}>Open again</button>
          <TransactionFlow
            open={open}
            title="Distribute"
            summary="Sends it."
            tx={{ canRoute: "node/can-distribute", route: "node/distribute" }}
            confirmLabel="Distribute"
            armDelayMs={0}
            onClose={() => setOpen(false)}
          />
        </RocketpoolApiProvider>
      );
    }
    const api = createMockRocketpoolApi({ scenario: "minipool", waitMs: 60_000 });
    render(<Reopen api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    await screen.findByText(/Sent. Waiting/);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Open again" }));
    expect(screen.getByText(/Sent. Waiting/)).toBeInTheDocument();
    const waits = api.calls.filter((c) => c.path === "/api/sn/wait").map((c) => c.params.txHash);
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBe(waits[0]);
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("an answer without a tx hash is treated as unclear too", async () => {
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

  it("losing track while waiting re-checks the same tx, never sends again", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool", failures: { wait: "timeout" } });
    const { posts } = setup(api);
    await userEvent.click(await screen.findByRole("button", { name: "Distribute" }));
    expect(await screen.findByText("Sent, but the result isn't known yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check the transaction again" }));
    await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/sn/wait")).toHaveLength(2));
    expect(await screen.findByText("Sent, but the result isn't known yet")).toBeInTheDocument();
    const waits = api.calls.filter((c) => c.path === "/api/sn/wait").map((c) => c.params.txHash);
    expect(waits[0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(waits[1]).toBe(waits[0]);
    expect(posts()).toHaveLength(1);
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
});
