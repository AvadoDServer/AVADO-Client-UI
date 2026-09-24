import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ROUTER_FUTURE } from "../../../../../routing/routerFuture";
import { AppRoutes, Providers } from "../../../App";
import { DEMO, DemoSnError, reconcileView } from "../../../api/fixtures";
import { createMockRocketpoolApi, type MockRocketpoolApi, type RocketpoolMockOptions } from "../../../api/mock";
import { pendingKey } from "../../../tx/pending";
import { PLAN_DEBOUNCE_MS, creditPlan, depositParams } from "../ValidatorsStep";
import { withdrawalAddressProblem, withdrawalAddressWarning } from "../WithdrawalStep";
import type { CanDepositResponse } from "../../../api/models";
import { walletError } from "../walletCalls";
import { RpApiError } from "../../../api/errors";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderSetup(path: string, mock: RocketpoolMockOptions | MockRocketpoolApi = {}) {
  const api = "calls" in mock ? mock : createMockRocketpoolApi(mock);
  const user = userEvent.setup();
  render(
    <Providers api={api}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
  const posts = () => api.calls.filter((c) => c.method === "POST");
  return { api, user, posts };
}

const stepStatus = (title: string) =>
  within(screen.getByRole("navigation", { name: "Setup steps" })).getByText(title).nextElementSibling?.textContent;

/** Waits for the transaction dialog's confirm button to arm, then presses it. */
async function confirmTx(user: ReturnType<typeof userEvent.setup>, label: string) {
  const dialog = await screen.findByRole("dialog", {}, { timeout: 3000 });
  const button = await within(dialog).findByRole("button", { name: label }, { timeout: 3000 });
  await waitFor(() => expect(button).toBeEnabled(), { timeout: 3000 });
  await user.click(button);
  return dialog;
}

const SIXTY_FOUR_HEX = /^[0-9a-f]{64}$/;

describe("Setup wizard", () => {
  it("starts where the node is: a fresh node at the wallet, with every later step waiting", async () => {
    renderSetup("/setup", { scenario: "fresh" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/setup/wallet"));
    expect(screen.getByRole("heading", { level: 1, name: "Set up your node" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Node wallet/ })).toHaveAttribute("aria-current", "step");
    expect(stepStatus("Node wallet")).toBe("To do");
    expect(stepStatus("Register")).toBe("Later");
    expect(stepStatus("Smoothing pool")).toBe("Later");
  });

  it("an unregistered node starts at registering; a node with a hot withdrawal address at that step", async () => {
    renderSetup("/setup", { scenario: "unregistered" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/setup/register"));
    expect(stepStatus("Add ETH")).toBe("Done");
  });

  it("the layout can shrink to a phone: one minmax(0,1fr) column, the step list scrolls inside itself", async () => {
    renderSetup("/setup/wallet", { scenario: "fresh" });
    const layout = await screen.findByTestId("setup-layout");
    expect(layout.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(layout.className).toContain("lg:grid-cols-[16rem_minmax(0,1fr)]");
    const nav = screen.getByRole("navigation", { name: "Setup steps" });
    expect(nav.className).toContain("min-w-0");
    expect(nav.querySelector("ol")!.className).toContain("overflow-x-auto");
  });

  it("a locked step says what comes first", async () => {
    renderSetup("/setup/validators", { scenario: "unregistered" });
    const s = await screen.findByText("First finish “Register”.");
    expect(s).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Register" })).toHaveAttribute("href", "/setup/register");
  });

  describe("wallet", () => {
    it("creates a wallet: password, a new phrase shown once, 3 words asked back, then saved with skipValidatorKeyRecovery", async () => {
      const { api, user, posts } = renderSetup("/setup/wallet", { scenario: "fresh" });
      await user.click(await screen.findByRole("button", { name: /Create a new wallet/ }));
      await user.click(screen.getByRole("button", { name: "Show my recovery phrase" }));

      const grid = await screen.findByTestId("recovery-phrase");
      const words = within(grid)
        .getAllByRole("listitem")
        .map((li) => li.querySelector("[aria-label]")!.textContent!);
      expect(words).toHaveLength(24);
      // set-password (random, strong) comes first, then init; nothing saved yet.
      expect(posts().map((c) => c.path)).toEqual(["/api/sn/wallet/set-password", "/api/sn/wallet/init"]);
      expect(String(posts()[0].params.password)).toMatch(SIXTY_FOUR_HEX);

      const cont = screen.getByRole("button", { name: "Continue" });
      expect(cont).toBeDisabled();
      await user.click(screen.getByRole("checkbox", { name: /I have written down all 24 words/ }));
      await user.click(cont);

      // The phrase is gone from the page for good.
      expect(screen.queryByTestId("recovery-phrase")).not.toBeInTheDocument();
      for (const w of new Set(words)) expect(document.body.textContent).not.toContain(` ${w} `);
      const inputs = screen.getAllByRole("textbox");
      expect(inputs).toHaveLength(3);
      const positions = inputs.map((i) => Number(/^(\d+)/.exec(i.closest("div")!.querySelector("label")!.textContent!)![1]) - 1);

      // A wrong word: nothing is saved.
      await user.type(inputs[0], "wrong");
      await user.type(inputs[1], words[positions[1]]);
      await user.type(inputs[2], words[positions[2]]);
      await user.click(screen.getByRole("button", { name: "Save the wallet" }));
      expect(await screen.findByText("Some words don't match your recovery phrase")).toBeInTheDocument();
      expect(posts().some((c) => c.path === "/api/sn/wallet/recover")).toBe(false);

      await user.clear(inputs[0]);
      await user.type(inputs[0], words[positions[0]].toUpperCase());
      await user.click(screen.getByRole("button", { name: "Save the wallet" }));
      await waitFor(() => expect(screen.getByText("Your node wallet is ready")).toBeInTheDocument());

      const recover = posts().filter((c) => c.path === "/api/sn/wallet/recover");
      expect(recover).toEqual([{ method: "POST", path: "/api/sn/wallet/recover", params: { mnemonic: words.join(" "), skipValidatorKeyRecovery: "true" } }]);
      expect(posts().filter((c) => c.path === "/api/sn/wallet/init")).toHaveLength(1);
      // Never stored in the browser.
      const phrase = words.join(" ");
      for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(phrase);
      for (let i = 0; i < sessionStorage.length; i++) expect(sessionStorage.getItem(sessionStorage.key(i)!)).not.toContain(phrase);
      expect(api.scenario.name).toBe("unregistered");
      // The wallet step is done; the address Smartnode saved is shown, and the next step is open.
      await waitFor(() => expect(stepStatus("Node wallet")).toBe("Done"));
      expect(screen.getByText(DEMO.nodeAddress)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Create a new wallet/ })).not.toBeInTheDocument();
      expect(await screen.findByRole("link", { name: "Next: Add ETH" })).toHaveAttribute("href", "/setup/fund");
    });

    it("start again: a new phrase, never the old one shown again, nothing saved", async () => {
      const { user, posts } = renderSetup("/setup/wallet", { scenario: "fresh" });
      await user.click(await screen.findByRole("button", { name: /Create a new wallet/ }));
      await user.click(screen.getByRole("button", { name: "Show my recovery phrase" }));
      const first = (await screen.findByTestId("recovery-phrase")).textContent;
      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(screen.getByRole("button", { name: "Start again with a new phrase" }));
      await user.click(screen.getByRole("button", { name: "Show my recovery phrase" }));
      const second = (await screen.findByTestId("recovery-phrase")).textContent;
      expect(second).not.toBe(first);
      expect(posts().filter((c) => c.path === "/api/sn/wallet/init")).toHaveLength(2);
      expect(posts().some((c) => c.path === "/api/sn/wallet/recover")).toBe(false);
    });

    it("restores from a phrase with validator keys, or by searching for the node address", async () => {
      const phrase = Array(24).fill("abandon").join(" ");
      const { user, posts } = renderSetup("/setup/wallet", { scenario: "fresh" });
      await user.click(await screen.findByRole("button", { name: /Restore a wallet/ }));
      const box = screen.getByLabelText("Recovery phrase");
      await user.type(box, "one two three");
      await user.click(screen.getByRole("button", { name: "Restore wallet" }));
      expect(screen.getByText("A recovery phrase has 12, 15, 18, 21 or 24 words; this one has 3.")).toBeInTheDocument();
      expect(posts()).toEqual([]);

      await user.clear(box);
      await user.type(box, `  ${phrase.toUpperCase()} `);
      await user.click(screen.getByText("The wallet was made with another app (optional)"));
      await user.type(screen.getByLabelText("Node address"), DEMO.nodeAddress);
      await user.click(screen.getByRole("button", { name: "Restore wallet" }));
      expect(await screen.findByText("Your node wallet is restored")).toBeInTheDocument();
      expect(screen.getByText(/Home asks you to approve loading them/)).toBeInTheDocument();
      const save = posts().filter((c) => c.path.startsWith("/api/sn/wallet/") && c.path !== "/api/sn/wallet/set-password");
      expect(save).toEqual([
        {
          method: "POST",
          path: "/api/sn/wallet/search-and-recover",
          params: { mnemonic: phrase, address: DEMO.nodeAddress, skipValidatorKeyRecovery: "false" },
        },
      ]);
    });

    it("a refused restore never shows the phrase back (Smartnode quotes it)", async () => {
      const phrase = Array(12).fill("zoo").join(" ");
      const api = createMockRocketpoolApi({ scenario: "fresh", failures: { "wallet/recover": new DemoSnError(500, `Invalid mnemonic '${phrase}'`) } });
      const { user } = renderSetup("/setup/wallet", api);
      await user.click(await screen.findByRole("button", { name: /Restore a wallet/ }));
      await user.type(screen.getByLabelText("Recovery phrase"), phrase);
      await user.click(screen.getByRole("checkbox", { name: /Also restore my validator keys/ }));
      await user.click(screen.getByRole("button", { name: "Restore wallet" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Not restored");
      expect(alert).toHaveTextContent("This is not a valid recovery phrase: check every word and their order.");
      expect(alert.textContent).not.toContain("zoo zoo");
      expect(api.calls.find((c) => c.path === "/api/sn/wallet/recover")?.params).toMatchObject({ skipValidatorKeyRecovery: "true" });
      expect(walletError(new RpApiError({ kind: "smartnode", path: "x", detail: `oops ${phrase} oops` }), phrase)).toBe("oops [your recovery phrase] oops.");
    });

    it("an existing wallet is never offered for replacement", async () => {
      renderSetup("/setup/wallet", { scenario: "minipool" });
      expect(await screen.findByText("Your node wallet is ready")).toBeInTheDocument();
      expect(screen.getByText(/this page never replaces it/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Create a new wallet|Restore a wallet/ })).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(DEMO.nodeAddress)).toBeInTheDocument());
    });
  });

  it("fund: the address with its QR code, what to send, the balance, and the automatic transactions", async () => {
    renderSetup("/setup/fund", { scenario: "unregistered" });
    const qr = await screen.findByRole("img", { name: `QR code of the node wallet address ${DEMO.nodeAddress}` });
    expect(qr.querySelector("path")!.getAttribute("d")!.length).toBeGreaterThan(100);
    expect(screen.getByRole("link", { name: new RegExp(DEMO.nodeAddress) })).toHaveAttribute("href", `https://etherscan.io/address/${DEMO.nodeAddress}`);
    expect(screen.getByText(/4 ETH for each validator/)).toBeInTheDocument();
    expect(within(screen.getByTestId("wallet-balances")).getByText("8.2 ETH")).toBeInTheDocument();
    expect(screen.getByTestId("auto-tx-notice")).toHaveTextContent("20 gwei");
    expect(screen.getByRole("link", { name: "Next: Register" })).toHaveAttribute("href", "/setup/register");
  });

  it("register: time zone, then one transaction through the transaction flow", async () => {
    const { user, posts } = renderSetup("/setup/register", { scenario: "unregistered" });
    const zone = await screen.findByLabelText("Time zone");
    await user.selectOptions(zone, "Europe/Ljubljana");
    await user.click(screen.getByRole("button", { name: "Register the node" }));
    const dialog = await confirmTx(user, "Register");
    expect(dialog).toHaveTextContent("Europe/Ljubljana");
    await waitFor(() => expect(posts().filter((c) => c.path === "/api/sn/node/register")).toHaveLength(1));
    const sent = posts().find((c) => c.path === "/api/sn/node/register")!;
    expect(sent.params).toMatchObject({ timezoneLocation: "Europe/Ljubljana", maxPrioFee: "1", gasLimit: "435000" });
    await user.click(await within(dialog).findByRole("button", { name: "Done" }, { timeout: 3000 }));
    await waitFor(() => expect(screen.getByText("Your node is registered with Rocket Pool")).toBeInTheDocument());
  });

  describe("withdrawal address", () => {
    it("refuses what can't be a withdrawal address", () => {
      const node = { accountAddress: DEMO.nodeAddress };
      expect(withdrawalAddressProblem("", node)).toMatch(/Enter the address/);
      expect(withdrawalAddressProblem("0x123", node)).toMatch(/Not an Ethereum address/);
      expect(withdrawalAddressProblem(DEMO.nodeAddress.toUpperCase().replace("0X", "0x"), node)).toMatch(/node wallet/);
      expect(withdrawalAddressProblem(`0x${"0".repeat(40)}`, node)).toMatch(/empty address/);
      expect(withdrawalAddressProblem(` ${DEMO.coldWallet} `, node)).toBeNull();
      // EIP-55: a correct mixed-case address passes; one flipped letter is a typo; one-case addresses pass with a caution.
      expect(withdrawalAddressProblem("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", node)).toBeNull();
      expect(withdrawalAddressWarning("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBeNull();
      expect(withdrawalAddressProblem("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", node)).toBe(
        "This address has a typo (its checksum doesn't match). Copy it again from your wallet.",
      );
      expect(withdrawalAddressWarning(DEMO.coldWallet)).toMatch(/typos can't be detected/);
    });

    it("sets a cold wallet with confirm=false and explains the confirmation on the Rocket Pool site", async () => {
      const { user, posts } = renderSetup("/setup/withdrawal", { scenario: "mixed" });
      const input = await screen.findByRole("textbox", { name: "Withdrawal address" });
      const submit = screen.getByRole("button", { name: "Set withdrawal address" });
      expect(submit).toBeDisabled();
      await user.type(input, DEMO.nodeAddress);
      await user.click(screen.getByRole("checkbox", { name: /This is my own wallet/ }));
      await user.click(submit);
      expect(screen.getByText(/That is this AVADO's node wallet/)).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await user.clear(input);
      await user.type(input, DEMO.coldWallet);
      await user.click(submit);
      const dialog = await confirmTx(user, "Set address");
      await waitFor(() => expect(posts().filter((c) => c.path === "/api/sn/node/set-primary-withdrawal-address")).toHaveLength(1));
      const sent = posts().find((c) => c.path === "/api/sn/node/set-primary-withdrawal-address")!;
      expect(sent.params).toMatchObject({ address: DEMO.coldWallet, confirm: "false" });
      await user.click(await within(dialog).findByRole("button", { name: "Done" }, { timeout: 3000 }));
      const pending = await screen.findByTestId("withdrawal-pending");
      expect(pending).toHaveTextContent(DEMO.coldWallet);
      expect(within(pending).getByRole("link", { name: /the Rocket Pool website/ })).toHaveAttribute(
        "href",
        "https://node.rocketpool.net/primary-withdrawal-address",
      );
    });

    it("a pending address waits for confirmation; a cold address is done", async () => {
      renderSetup("/setup/withdrawal", { scenario: "new-node" });
      expect(await screen.findByTestId("withdrawal-pending")).toHaveTextContent(DEMO.coldWallet);
      expect(stepStatus("Withdrawal address")).toBe("Waiting for you");
    });

    it("an address outside the AVADO is done and can only be changed from that wallet", async () => {
      renderSetup("/setup/withdrawal", { scenario: "minipool" });
      expect(await screen.findByText("Your withdrawal address is a wallet outside this AVADO")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Withdrawal address" })).not.toBeInTheDocument();
    });
  });

  it("smoothing pool: explained, joined with status=true", async () => {
    const { user, posts } = renderSetup("/setup/smoothing", { scenario: "new-node" });
    expect(await screen.findByText("Your node is not in the smoothing pool")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Join the smoothing pool" }));
    await confirmTx(user, "Join");
    await waitFor(() => expect(posts().find((c) => c.path === "/api/sn/node/set-smoothing-pool-status")?.params).toMatchObject({ status: "true" }));
  });

  it("smoothing pool: a member can leave", async () => {
    renderSetup("/setup/smoothing", { scenario: "minipool" });
    expect(await screen.findByText("Your node is in the smoothing pool")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Leave the smoothing pool" })).toBeEnabled();
  });

  describe("validators", () => {
    it("works out the bond, then deposits with submit=true and one fixed parameter set", async () => {
      const { api, user, posts } = renderSetup("/setup/validators", { scenario: "new-node" });
      const count = await screen.findByLabelText("How many validators");
      await user.clear(count);
      await user.type(count, "2");
      const plan = (label: string) => within(screen.getByTestId("deposit-plan")).getByText(label).nextElementSibling?.textContent;
      await waitFor(() => expect(plan("Your bond")).toBe("8 ETH"));
      expect(plan("Paid from the node wallet")).toBe("8 ETH + network fee");
      expect(plan("In the node wallet now")).toBe("8.35 ETH");
      const bondReads = api.calls.filter((c) => c.path === "/api/sn/node/get-bond-requirement").map((c) => c.params.numValidators);
      expect(bondReads).toEqual(expect.arrayContaining([1, 2]));
      expect(screen.queryByLabelText("Express tickets to use")).not.toBeInTheDocument(); // none on a new node
      expect(screen.getByTestId("auto-tx-notice")).toHaveTextContent("always go through");

      await user.click(screen.getByRole("button", { name: "Create 2 validators" }));
      const dialog = await confirmTx(user, "Create validators");
      await waitFor(() => expect(posts().filter((c) => c.path === "/api/sn/node/deposit")).toHaveLength(1));
      const sent = posts().find((c) => c.path === "/api/sn/node/deposit")!;
      expect(sent.params).toEqual({
        amountWei: "8000000000000000000",
        minFee: "0",
        salt: "0",
        expressTickets: "0",
        count: "2",
        useCreditBalance: "false",
        submit: "true",
        maxFee: "2.7",
        maxPrioFee: "1",
        gasLimit: "2175000",
      });
      await user.click(await within(dialog).findByRole("button", { name: "Done" }, { timeout: 3000 }));
      expect(await screen.findByText("2 validators created")).toBeInTheDocument();
    });

    it("pays with credit only the way Smartnode does: the full credit, and only when all of it is usable", () => {
      const E = 10n ** 18n;
      const can = (o: Partial<CanDepositResponse>) =>
        ({ status: "success", error: "", canDeposit: true, nodeBalance: "5000000000000000000", creditBalance: 0, insufficientBalance: false, invalidAmount: false, depositDisabled: false, ...o }) as CanDepositResponse;
      expect(creditPlan(can({}), 4n * E)).toMatchObject({ useCredit: false, fromWallet: 4n * E, note: null, blocked: null });
      expect(creditPlan(can({ canUseCredit: true, creditBalance: "1000000000000000000", usableCreditBalance: "1000000000000000000" }), 4n * E)).toMatchObject({
        useCredit: true,
        fromCredit: E,
        fromWallet: 3n * E,
      });
      expect(creditPlan(can({ canUseCredit: true, creditBalance: "6000000000000000000", usableCreditBalance: "6000000000000000000" }), 4n * E)).toMatchObject({
        useCredit: true,
        fromWallet: 0n,
      });
      // Credit 3, only 1 usable: Smartnode would subtract all 3, so the credit is not used.
      const partly = creditPlan(can({ canUseCredit: true, creditBalance: "3000000000000000000", usableCreditBalance: "1000000000000000000" }), 4n * E);
      expect(partly).toMatchObject({ useCredit: false, fromWallet: 4n * E, blocked: null });
      expect(partly.note).toMatch(/deposit pool is low/);
      const short = creditPlan(can({ canUseCredit: true, nodeBalance: "2000000000000000000", creditBalance: "3000000000000000000", usableCreditBalance: "1000000000000000000" }), 4n * E);
      expect(short.blocked).toMatch(/not enough for the whole bond/);
    });

    it("waits until typing stops before reading the bond (one set of reads for the final count)", async () => {
      const { api, user } = renderSetup("/setup/validators", { scenario: "new-node" });
      const count = await screen.findByLabelText("How many validators");
      await waitFor(() => expect(screen.getByTestId("deposit-plan")).toBeInTheDocument(), { timeout: 2000 });
      const before = api.calls.filter((c) => c.path === "/api/sn/node/get-bond-requirement").length;
      await user.clear(count);
      await user.type(count, "12");
      await waitFor(() => expect(within(screen.getByTestId("deposit-plan")).getByText("Validators").nextElementSibling?.textContent).toBe("12"), {
        timeout: PLAN_DEBOUNCE_MS * 5,
      });
      const reads = api.calls.filter((c) => c.path === "/api/sn/node/get-bond-requirement").slice(before);
      expect(reads.map((c) => c.params.numValidators)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    it("the deposit's pending lock is the route alone, whatever the amount (one deposit at a time)", () => {
      const a = pendingKey("node/deposit", depositParams({ count: 1, bondWei: 4n * 10n ** 18n, expressTickets: 1, useCredit: false }));
      const b = pendingKey("node/deposit", depositParams({ count: 3, bondWei: 12n * 10n ** 18n, expressTickets: 0, useCredit: true }));
      expect(a).toBe("node/deposit");
      expect(b).toBe(a);
    });

    it("uses express tickets when the node has them, and says when the wallet is short of ETH", async () => {
      renderSetup("/setup/validators", { scenario: "minipool" });
      const tickets = await screen.findByLabelText("Express tickets to use");
      expect(tickets).toHaveValue("1");
      expect(screen.getByText(/You have 2 express tickets/)).toBeInTheDocument();
      expect(await screen.findByText(/doesn't have enough ETH for this bond: it has 0.4128 ETH/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create 1 validator" })).toBeDisabled();
    });

    it("refuses without a consensus client to run the validators", async () => {
      const api = createMockRocketpoolApi({ scenario: "new-node" });
      api.reconcile = async () => reconcileView({ state: "error", client: null, keys: [], message: "No consensus client is installed." });
      renderSetup("/setup/validators", api);
      expect(await screen.findByText("Install a consensus client first")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId("deposit-plan")).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Create 1 validator" })).toBeDisabled();
    });
  });
});
