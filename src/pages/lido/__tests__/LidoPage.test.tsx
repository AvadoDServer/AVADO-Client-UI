import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApi, fakeHex, MOCK_DEFAULT_FEE_RECIPIENT, MOCK_MEVBOOST_RELAYS, MOCK_PACKAGES, MOCK_SETTINGS, type MockOptions } from "../../../api/mock";
import { MOCK_LIDO_PUBKEYS, mockLidoDepositData, mockLidoOptions } from "../../../api/mockLido";
import type { Api } from "../../../api/types";
import { LIDO_NETWORKS } from "../../../lib/lido";
import { renderWithApi } from "../../validators/__tests__/renderWithApi";
import LidoPage, { MEVBOOST_PACKAGE } from "../LidoPage";

const VAULT = LIDO_NETWORKS.mainnet!.elRewardsVault;
const OTHER_RELAY = `https://${fakeHex(77, 48)}@relay.example.org`;

function renderPage(opts: MockOptions = {}, config = {}): Api {
  const api = createMockApi(mockLidoOptions(opts));
  renderWithApi(<LidoPage pollMs={60_000} retryMs={60_000} />, api, config);
  return api;
}

const checks = async () => within(await screen.findByRole("list", { name: "Lido checks" }));

describe("LidoPage", () => {
  it("explains CSM, links to Lido's app and shows Lido's withdrawal address in the key step", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Lido CSM" })).toBeInTheDocument();
    expect(screen.getByText(/2.4 ETH for the first validator/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Lido's CSM app/ })[0]).toHaveAttribute("href", "https://csm.lido.fi");
    const steps = within(screen.getByRole("list", { name: "Steps" }));
    expect(steps.getByText(LIDO_NETWORKS.mainnet!.withdrawalVault)).toBeInTheDocument();
    await checks();
  });

  it("finds the Lido validator with the wrong fee recipient and sends its rewards to Lido", async () => {
    const api = renderPage();
    const c = await checks();
    expect(await c.findByText("1 validator sends its block rewards to the wrong address")).toBeInTheDocument();
    expect(c.getByText(/Validator 1874412/)).toBeInTheDocument();
    const set = vi.spyOn(api.keymanager, "setFeeRecipient");
    await userEvent.click(c.getByRole("button", { name: "Send them to Lido" }));
    expect(await screen.findByText("1 validator now sends its block rewards to Lido.")).toBeInTheDocument();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(MOCK_LIDO_PUBKEYS.lidoWrongFee, VAULT);
    expect(await api.keymanager.getFeeRecipient(MOCK_LIDO_PUBKEYS.lidoWrongFee)).toBe(VAULT);
    expect(await c.findByText("2 validators for Lido, block rewards go to Lido")).toBeInTheDocument();
    // Only the Lido key was touched.
    expect(await api.keymanager.getFeeRecipient(MOCK_LIDO_PUBKEYS.lidoActive)).toBe(VAULT);
  });

  it("lists the Lido validators with their status", async () => {
    renderPage();
    const list = within(await screen.findByRole("list", { name: "Lido validators" }));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.getByText("Rewards to Lido")).toBeInTheDocument();
    expect(list.getByText("Rewards to the wrong address")).toBeInTheDocument();
  });

  it("says when every Lido validator is set up right", async () => {
    renderPage({ feeRecipients: { [MOCK_LIDO_PUBKEYS.lidoActive]: VAULT, [MOCK_LIDO_PUBKEYS.lidoWrongFee]: VAULT } });
    const c = await checks();
    expect(await c.findByText("2 validators for Lido, block rewards go to Lido")).toBeInTheDocument();
    expect(c.getByText("MEV-Boost relays are on Lido's list")).toBeInTheDocument();
  });

  it("says there are no Lido validators on a box without them", async () => {
    const api = createMockApi();
    renderWithApi(<LidoPage pollMs={60_000} retryMs={60_000} />, api);
    const c = await checks();
    expect(await c.findByText("No Lido validators on this node yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Lido validators" })).toBeNull();
  });

  it("warns about one of your own validators that gives its rewards to Lido, and can undo it", async () => {
    const api = renderPage({
      feeRecipients: { [MOCK_LIDO_PUBKEYS.lidoActive]: VAULT, [MOCK_LIDO_PUBKEYS.lidoWrongFee]: VAULT, [fakeHex(1, 48)]: VAULT },
    });
    const c = await checks();
    expect(await c.findByText("1 of your own validators gives its rewards to Lido")).toBeInTheDocument();
    await userEvent.click(c.getByRole("button", { name: "Use my default address" }));
    expect(await screen.findByText("1 validator uses your default fee recipient again.")).toBeInTheDocument();
    expect(await api.keymanager.getFeeRecipient(fakeHex(1, 48))).toBe(MOCK_DEFAULT_FEE_RECIPIENT);
  });

  it("points to Settings when the default fee recipient is Lido's address", async () => {
    renderPage({
      settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: VAULT },
      feeRecipients: {},
    });
    const c = await checks();
    expect(await c.findByText(/of your own validators gives? (its|their) rewards to Lido/)).toBeInTheDocument();
    expect(c.getByText(/Your default fee recipient in Settings is Lido's address/)).toBeInTheDocument();
    expect(c.getByRole("link", { name: "Change the default" })).toHaveAttribute("href", "/settings?focus=fee-recipient");
  });

  describe("MEV-Boost", () => {
    it("passes AVADO's default relays", async () => {
      renderPage();
      const c = await checks();
      expect(await c.findByText("MEV-Boost relays are on Lido's list")).toBeInTheDocument();
      expect(c.getByText(/All 7 relays MEV-Boost uses are allowed by Lido/)).toBeInTheDocument();
    });

    it("names a relay that is not on Lido's list", async () => {
      renderPage({ packageEnvs: { [MEVBOOST_PACKAGE]: { RELAYS: `${MOCK_MEVBOOST_RELAYS},${OTHER_RELAY}` } } });
      const c = await checks();
      expect(await c.findByText("Some relays are not on Lido's list")).toBeInTheDocument();
      expect(c.getByText(/Turn these off in MEV-Boost: relay.example.org/)).toBeInTheDocument();
      expect(c.getByRole("link", { name: "Change relays" })).toHaveAttribute("href", expect.stringContaining("mevboost.avado.dnp.dappnode.eth"));
    });

    it("says when MEV-Boost is off in the client's settings", async () => {
      renderPage({ settings: { ...MOCK_SETTINGS, mev_boost: false } });
      const c = await checks();
      expect(await c.findByText("MEV-Boost is off")).toBeInTheDocument();
      expect(c.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "/settings");
    });

    it("says when MEV-Boost is on but its package is not installed", async () => {
      renderPage({ packages: MOCK_PACKAGES.filter((p) => p !== MEVBOOST_PACKAGE) });
      const c = await checks();
      expect(await c.findByText("MEV-Boost is on, but not installed")).toBeInTheDocument();
    });

    it("can't check when the DAPPMANAGER doesn't answer, and says so", async () => {
      const api = createMockApi(mockLidoOptions());
      vi.spyOn(api.dappmanager, "packageEnvs").mockRejectedValue(new Error("WAMP down"));
      renderWithApi(<LidoPage pollMs={60_000} retryMs={60_000} />, api);
      const c = await checks();
      expect(await c.findByText("MEV-Boost relays: can't check right now")).toBeInTheDocument();
    });

    it("doesn't check relays on Hoodi (AVADO's MEV-Boost runs on mainnet)", async () => {
      renderPage({}, { network: "hoodi" });
      const c = await checks();
      expect(await c.findByText("MEV-Boost relays: not checked on this network")).toBeInTheDocument();
    });

    it("doesn't ask to turn MEV-Boost on on Hoodi", async () => {
      renderPage({ settings: { ...MOCK_SETTINGS, mev_boost: false } }, { network: "hoodi" });
      const c = await checks();
      expect(await c.findByText("MEV-Boost relays: not checked on this network")).toBeInTheDocument();
      expect(c.queryByText("MEV-Boost is off")).toBeNull();
      expect(c.queryByRole("link", { name: "Open Settings" })).toBeNull();
    });
  });

  describe("deposit data for keys added before", () => {
    it("sets Lido's fee recipient for the keys in the file that are on this node", async () => {
      const api = renderPage();
      await checks();
      const set = vi.spyOn(api.keymanager, "setFeeRecipient");
      const notHere = fakeHex(99, 48);
      const file = new File([mockLidoDepositData([MOCK_LIDO_PUBKEYS.lidoQueued, MOCK_LIDO_PUBKEYS.lidoActive, notHere])], "deposit_data-1.json", {
        type: "application/json",
      });
      await userEvent.upload(screen.getByLabelText("Choose the deposit data file"), file);
      // lidoActive already pays Lido: only lidoQueued needs it.
      expect(await screen.findByText(/1 validator from deposit_data-1.json is on this node and doesn't send block rewards to Lido yet/)).toBeInTheDocument();
      expect(screen.getByText(/1 validator from the file isn't on this node/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Send their rewards to Lido" }));
      expect(await screen.findByText("1 validator now sends its block rewards to Lido.")).toBeInTheDocument();
      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(MOCK_LIDO_PUBKEYS.lidoQueued, VAULT);
    });

    it("refuses a deposit data file whose keys don't pay out to Lido", async () => {
      const api = renderPage();
      await checks();
      const set = vi.spyOn(api.keymanager, "setFeeRecipient");
      const own = `0x01${"00".repeat(11)}${"cd".repeat(20)}`;
      const file = new File([mockLidoDepositData([MOCK_LIDO_PUBKEYS.lidoQueued], own)], "deposit_data-2.json", { type: "application/json" });
      await userEvent.upload(screen.getByLabelText("Choose the deposit data file"), file);
      expect(await screen.findByText(/None of the keys in deposit_data-2.json pays out to Lido/)).toBeInTheDocument();
      expect(set).not.toHaveBeenCalled();
    });

    it("refuses a keystore or another file", async () => {
      renderPage();
      await checks();
      await userEvent.upload(screen.getByLabelText("Choose the deposit data file"), new File(["{}"], "keystore.json", { type: "application/json" }));
      expect(await screen.findByText(/keystore.json isn't a deposit data file/)).toBeInTheDocument();
    });

    it("says when none of the file's keys is on this node yet", async () => {
      renderPage();
      await checks();
      const file = new File([mockLidoDepositData([fakeHex(98, 48)])], "deposit_data-3.json", { type: "application/json" });
      await userEvent.upload(screen.getByLabelText("Choose the deposit data file"), file);
      expect(await screen.findByText(/The validator in deposit_data-3.json isn't on this node yet/)).toBeInTheDocument();
    });
  });

  it("explains that Lido CSM is not available on other networks", async () => {
    const api = createMockApi();
    renderWithApi(<LidoPage />, api, { network: "gnosis" });
    expect(screen.getByText("Not on this network")).toBeInTheDocument();
    expect(screen.getByText(/This node runs on gnosis/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("list", { name: "Lido checks" })).toBeNull());
  });
});
