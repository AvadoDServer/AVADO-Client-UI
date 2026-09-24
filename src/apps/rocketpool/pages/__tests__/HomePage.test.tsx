import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createFetchMock } from "../../../../api/__tests__/fetchMock";
import { ROUTER_FUTURE } from "../../../../routing/routerFuture";
import { AppRoutes, Providers } from "../../App";
import { RpApiError, plainError } from "../../api/errors";
import { DEMO } from "../../api/fixtures";
import { createMockRocketpoolApi, type MockRocketpoolApi, type RocketpoolMockOptions } from "../../api/mock";
import { ARCHIVE_CONFIRMATION } from "../../api/models";
import { createRealRocketpoolApi } from "../../api/real";
import { SLASHING_WARNING, approvalOutcome } from "../home/KeyApproval";
import { SCENARIOS, demoKey, reconcileView } from "../../api/fixtures";
import { reconcileStatusOf } from "../../api/reconcile";

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function renderHome(mock: RocketpoolMockOptions | MockRocketpoolApi = {}) {
  const api = "calls" in mock ? mock : createMockRocketpoolApi(mock);
  render(
    <Providers api={api}>
      <MemoryRouter initialEntries={["/"]} future={ROUTER_FUTURE}>
        <AppRoutes />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
  return api;
}

const card = (name: string) => screen.getByRole("region", { name });
const rowValue = (testId: string, label: string) => within(screen.getByTestId(testId)).getByText(label).nextElementSibling?.textContent;

describe("Home", () => {
  it("a healthy minipool node: health, balances, validators, rewards; nothing to fix", async () => {
    const api = renderHome({ scenario: "minipool" });
    await waitFor(() => expect(rowValue("balances", "ETH")).toBe("0.4128 ETH"));
    expect(rowValue("balances", "RPL")).toBe("12.5 RPL");
    expect(rowValue("balances", "rETH")).toBe("0 rETH");
    await waitFor(() => expect(rowValue("health", "Execution client")).toBe("In sync"));
    expect(rowValue("health", "Consensus client")).toBe("In sync");
    expect(rowValue("health", "Node wallet")).toBe("Ready");
    expect(rowValue("health", "Registered with Rocket Pool")).toBe("Yes");
    expect(rowValue("health", "Validator keys")).toBe("2/2 in sync with Nimbus");
    expect(rowValue("validators-summary", "Minipools")).toBe("2 staking");
    expect(rowValue("validators-summary", "Megapool validators")).toBe("None");
    // 18.4412 + 17.9021 RPL and 0.0412 + 0.0388 ETH over two intervals.
    await waitFor(() => expect(rowValue("rewards-summary", "Periodic rewards to claim")).toBe("36.34 RPL and 0.08 ETH"));
    expect(screen.queryByRole("region", { name: "Things to fix" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("key-approval")).not.toBeInTheDocument();
    expect(screen.queryByTestId("legacy-mnemonic")).not.toBeInTheDocument();
    expect(screen.queryByTestId("setup-callout")).not.toBeInTheDocument();
    expect(screen.getByTestId("auto-tx-notice")).toHaveTextContent("above 20 gwei");
    expect(screen.getByTestId("auto-tx-notice")).toHaveTextContent("in practice these transactions always go through");
    // Reads only, never a write.
    expect(api.calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("mixed node: the fixes with their buttons, the megapool, the fee distributor", async () => {
    renderHome({ scenario: "mixed" });
    const fixes = await screen.findByRole("region", { name: "Things to fix" });
    expect(within(fixes).getByText("Your withdrawal address is still the node wallet")).toBeInTheDocument();
    expect(within(fixes).getByText("Little ETH left for network fees")).toBeInTheDocument();
    expect(within(fixes).getByRole("link", { name: "Set withdrawal address" })).toHaveAttribute("href", "/setup/withdrawal");
    expect(within(fixes).getByRole("link", { name: "Add ETH" })).toHaveAttribute("href", "/setup/fund");
    await waitFor(() => expect(rowValue("validators-summary", "Megapool validators")).toBe("1 active, 1 in the queue"));
    expect(rowValue("validators-summary", "Minipools")).toBe("1 staking");
    await waitFor(() => expect(rowValue("rewards-summary", "Waiting in your fee distributor")).toBe("0.0931 ETH"));
    expect(rowValue("rewards-summary", "Waiting in your megapool")).toBe("0.0214 ETH");
    await userEvent.click(within(fixes).getByRole("link", { name: "Set withdrawal address" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/setup/withdrawal");
  });

  it("key approval: lists the key, warns, needs LOAD typed, sends exactly the awaiting keys once", async () => {
    const api = renderHome({ scenario: "mixed" });
    const box = await screen.findByTestId("key-approval");
    const waiting = within(box).getByTestId("awaiting-approval");
    expect(within(waiting).getByText("1 key is not loaded in Teku and waits for your approval")).toBeInTheDocument();
    expect(within(waiting).getByText("Megapool validator 1")).toBeInTheDocument();
    expect(within(waiting).getByRole("link", { name: /0x.*…/ })).toHaveAttribute("href", `https://beaconcha.in/validator/0x${DEMO.megaPubkey2}`);
    expect(within(waiting).getByText(SLASHING_WARNING)).toBeInTheDocument();
    expect(SLASHING_WARNING).toBe("Only do this if these validators are not running anywhere else — running a key on two machines gets it slashed.");
    expect(within(waiting).getByText(/Why Teku: The Rocket Pool package setting CONSENSUSCLIENT is "teku"/)).toBeInTheDocument();

    const button = within(waiting).getByRole("button", { name: "Load 1 validator key into Teku" });
    const input = within(waiting).getByLabelText(/to confirm/);
    expect(button).toBeDisabled();
    await userEvent.type(input, "load");
    expect(button).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "LOAD");
    expect(button).toBeEnabled();
    await userEvent.dblClick(button);

    expect(await within(box).findByText("Approved 1 key")).toBeInTheDocument();
    await waitFor(() => expect(within(box).getByTestId("approval-outcome")).toHaveTextContent("Loaded into Teku."));
    const approvals = api.calls.filter((c) => c.path === "/api/avado/reconcile/approve");
    expect(approvals).toEqual([{ method: "POST", path: "/api/avado/reconcile/approve", params: { pubkeys: [DEMO.megaPubkey2], confirm: "LOAD" } }]);
    // The status is read again: the key now counts as loaded, nothing waits any more.
    await waitFor(() => expect(within(box).queryByTestId("awaiting-approval")).not.toBeInTheDocument());
    await waitFor(() => expect(within(box).getByText(/Checked again/)).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("1 validator key needs your approval")).not.toBeInTheDocument());
  });

  it("key approval: a refusal is shown in the backend's words and nothing is claimed", async () => {
    const api = createMockRocketpoolApi({ scenario: "mixed" });
    api.approveKeys = async () => {
      throw new RpApiError({ kind: "http", path: "/api/avado/reconcile/approve", status: 400, detail: "At most 500 validator keys can be approved at once." });
    };
    renderHome(api);
    const box = await screen.findByTestId("key-approval");
    await userEvent.type(within(box).getByLabelText(/to confirm/), "LOAD");
    await userEvent.click(within(box).getByRole("button", { name: /^Load 1 validator key/ }));
    const alert = await within(box).findByRole("alert");
    expect(alert).toHaveTextContent("Not approved");
    expect(alert).toHaveTextContent("At most 500 validator keys can be approved at once.");
    expect(within(box).queryByText(/^Approved/)).not.toBeInTheDocument();
  });

  it("every key state the owner must know about: loaded twice, update the client, settling, blocked reasons", async () => {
    renderHome({ scenario: "keys-attention" });
    const box = await screen.findByTestId("key-approval");
    const twice = within(box).getByText("A key is loaded in two clients: remove it from one now").closest("div")!.parentElement!;
    expect(twice).toHaveTextContent("gets it slashed");
    expect(within(twice).getByRole("link", { name: /Nimbus/ })).toHaveAttribute("href", "http://my.ava.do/#/packages/nimbus.avado.dnp.dappnode.eth");
    expect(within(twice).getByRole("link", { name: /Teku/ })).toHaveAttribute("href", "http://my.ava.do/#/packages/teku.avado.dnp.dappnode.eth");

    expect(within(box).getByText("Update Teku first")).toBeInTheDocument();
    expect(within(box).getByText("Megapool validator 3")).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: /Open Teku in the AVADO Admin/ })).toBeInTheDocument();

    expect(within(box).getByText("1 key will be loaded soon")).toBeInTheDocument();
    expect(within(box).getByText(/^loads at about /)).toBeInTheDocument();

    const waiting = within(box).getByTestId("awaiting-approval");
    expect(within(waiting).getByText("2 keys are not loaded in Teku and wait for your approval")).toBeInTheDocument();
    expect(within(waiting).getByText("They can't be loaded right now, even after you approve:")).toBeInTheDocument();
    expect(within(waiting).getByText(/Teku 0.0.75 is too old/)).toBeInTheDocument();
    expect(within(waiting).getByRole("button", { name: "Load 2 validator keys into Teku" })).toBeDisabled();
    // Long pubkeys in the backend's message wrap anywhere (no sideways scrolling on a phone).
    expect(within(box).getByText(/is loaded in both Nimbus and Teku/).className).toContain("[overflow-wrap:anywhere]");
    // Approving while the old Teku blocks loading says so, instead of promising "a few minutes".
    await userEvent.type(within(waiting).getByLabelText(/to confirm/), "LOAD");
    await userEvent.click(within(waiting).getByRole("button", { name: "Load 2 validator keys into Teku" }));
    const outcome = await within(box).findByTestId("approval-outcome");
    await waitFor(() => expect(outcome).toHaveTextContent("Rocket Pool can't load them yet. They load once this is fixed:"));
    expect(outcome).toHaveTextContent("Teku 0.0.75 is too old");
    expect(outcome).not.toHaveTextContent("within a few minutes");
    // The shell's red banner is there too.
    expect(await screen.findByText("A validator key is loaded in two clients — this can get it slashed")).toBeInTheDocument();
  });

  it("legacy recovery-phrase file: explained, moved only with ARCHIVE typed, and then gone", async () => {
    const api = renderHome({ scenario: "mixed" });
    const box = await screen.findByTestId("legacy-mnemonic");
    expect(within(box).getByText("Your recovery phrase is stored in a plain file")).toBeInTheDocument();
    expect(box).toHaveTextContent("Make sure you have your own copy");
    expect(within(box).getByRole("link", { name: "support@ava.do" })).toHaveAttribute("href", "mailto:support@ava.do");
    const button = within(box).getByRole("button", { name: "Move it into the backups folder" });
    expect(button).toBeDisabled();
    await userEvent.type(within(box).getByLabelText(/to confirm/), "archive");
    expect(button).toBeDisabled();
    await userEvent.clear(within(box).getByLabelText(/to confirm/));
    await userEvent.type(within(box).getByLabelText(/to confirm/), ARCHIVE_CONFIRMATION);
    await userEvent.dblClick(button);
    expect(await within(box).findByText("The file is no longer in the Rocket Pool data folder")).toBeInTheDocument();
    expect(box).toHaveTextContent("backups/mnemonic-archive-20260923T101500Z");
    expect(box).toHaveTextContent("Nothing was deleted.");
    expect(api.calls.filter((c) => c.path === "/api/avado/legacy-mnemonic/archive")).toEqual([
      { method: "POST", path: "/api/avado/legacy-mnemonic/archive", params: { confirm: "ARCHIVE" } },
    ]);
    // The banner on every page goes away with the file.
    await waitFor(() => expect(screen.queryByText("Your recovery phrase is stored in a plain file")).not.toBeInTheDocument());
  });

  it("a new node without a wallet: the way into setup, and no node reads", async () => {
    const api = renderHome({ scenario: "fresh" });
    const callout = await screen.findByTestId("setup-callout");
    expect(within(callout).getByText("Set up your Rocket Pool node")).toBeInTheDocument();
    expect(within(callout).getByRole("link", { name: "Start setup" })).toHaveAttribute("href", "/setup");
    expect(rowValue("health", "Node wallet")).toBe("Not set up");
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(api.calls.some((c) => c.path.startsWith("/api/sn/node/"))).toBe(false);
  });

  it("an unregistered node and a node without validators each get their next step", async () => {
    renderHome({ scenario: "unregistered" });
    expect(await screen.findByText("Finish setting up your node")).toBeInTheDocument();
    expect(card("Setup")).toContainElement(screen.getByRole("link", { name: "Continue setup" }));
  });

  it("a registered node without validators: create them; a pending withdrawal address says how to confirm", async () => {
    renderHome({ scenario: "new-node" });
    const callout = await screen.findByTestId("setup-callout");
    expect(within(callout).getByRole("link", { name: "Create validators" })).toHaveAttribute("href", "/setup/validators");
    const fixes = await screen.findByRole("region", { name: "Things to fix" });
    expect(within(fixes).getByText("Confirm your new withdrawal address")).toBeInTheDocument();
    expect(within(fixes).getByRole("link", { name: "How to confirm" })).toHaveAttribute("href", "/setup/withdrawal");
  });
});

describe("what approving keys will really do", () => {
  it("settling keys: the 20-minute safety wait and its time; otherwise a few minutes", () => {
    const settling = reconcileStatusOf(
      reconcileView({ state: "attention", client: { id: "teku", name: "Teku", package: "teku.avado.dnp.dappnode.eth" }, keys: [demoKey(DEMO.megaPubkey2, "megapool", "1", "settling", "megapool", DEMO.megapool)] }),
    )!;
    const o = approvalOutcome(settling, [DEMO.megaPubkey2], "Teku");
    expect(o.text).toMatch(/^Keys load after a 20-minute safety wait \(around [^)]*\d{2}[^)]*\)\.$/);
    const waiting = reconcileStatusOf(SCENARIOS.mixed.reconcile)!;
    expect(approvalOutcome(waiting, [DEMO.megaPubkey2], "Teku").text).toMatch(/within a few minutes/);
  });
});

describe("legacy archive call", () => {
  it("real: POSTs {confirm} as JSON with X-Avado-Request: 1, and passes refusals on", async () => {
    const f = createFetchMock()
      .on("POST", "/api/avado/legacy-mnemonic/archive", { status: 200, json: { status: "success", error: "", archived: true, name: "mnemonic-archive-x" } });
    const res = await createRealRocketpoolApi(f.fetch).archiveLegacyMnemonic("ARCHIVE");
    expect(res).toMatchObject({ archived: true, name: "mnemonic-archive-x" });
    expect(f.calls[0].headers["x-avado-request"]).toBe("1");
    expect(f.calls[0].body).toEqual({ confirm: "ARCHIVE" });

    const message = "No legacy recovery phrase file was found; there is nothing to archive.";
    const g = createFetchMock().on("POST", "/api/avado/legacy-mnemonic/archive", { status: 404, json: { status: "error", error: message } });
    const e = await createRealRocketpoolApi(g.fetch).archiveLegacyMnemonic("ARCHIVE").catch((x: RpApiError) => x);
    expect(e).toMatchObject({ kind: "http", status: 404 });
    expect(plainError(e)).toBe(message);
  });
});
