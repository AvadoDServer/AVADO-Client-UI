import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiProvider } from "../../../api/ApiProvider";
import { createMockApi, MOCK_DEFAULT_FEE_RECIPIENT, MOCK_DEFAULT_SETTINGS, MOCK_PACKAGES, MOCK_SETTINGS } from "../../../api/mock";
import type { Api, PackageBackend, Settings } from "../../../api/types";
import { ClientConfigProvider } from "../../../config/ClientConfigProvider";
import { normalizeClientConfig, type ClientConfig } from "../../../config/clientConfig";
import { MODE_STORAGE_KEY, ModeProvider } from "../../../settings/ModeProvider";
import SettingsPage from "../SettingsPage";

function renderPage(api: Api, config: Partial<ClientConfig> = {}, { advanced = false }: { advanced?: boolean } = {}) {
  if (advanced) localStorage.setItem(MODE_STORAGE_KEY, "advanced");
  return render(
    <ClientConfigProvider config={normalizeClientConfig(config)}>
      <ApiProvider api={api}>
        <ModeProvider>
          <SettingsPage />
        </ModeProvider>
      </ApiProvider>
    </ClientConfigProvider>,
  );
}

async function waitForLoaded() {
  await screen.findByLabelText("Default fee recipient");
}

describe("SettingsPage — loading an existing, fully-populated settings file", () => {
  it("pre-fills every field from the box", async () => {
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    expect(screen.getByLabelText("Default fee recipient")).toHaveValue(MOCK_DEFAULT_FEE_RECIPIENT);
    expect(screen.getByLabelText("Graffiti")).toHaveValue(MOCK_SETTINGS.validators_graffiti);
    expect(screen.getByRole("radio", { name: "Geth" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Enable MEV-Boost/ })).toBeChecked();
    // Nothing edited yet.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revert changes" })).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});

// Review focus item 1: an old settings.json missing fields (e.g. no mev_boost or
// execution_engine) loads, and saving one field doesn't drop the others.
describe("SettingsPage — an old settings.json missing fields", () => {
  const OLD_SETTINGS: Settings = {
    network: "mainnet",
    validators_graffiti: "Avado",
    validators_proposer_default_fee_recipient: "0x1111111111111111111111111111111111111111",
    // No mev_boost, no execution_engine, no ee_endpoint — and a field this UI has never heard of.
    some_future_field: "keep-me",
  };

  it("loads without crashing, showing safe defaults for the missing fields", async () => {
    const api = createMockApi({ settings: OLD_SETTINGS, packages: [] });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    expect(screen.getByLabelText("Graffiti")).toHaveValue("Avado");
    expect(screen.getByRole("checkbox", { name: /Enable MEV-Boost/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Enable MEV-Boost/ })).toBeDisabled();
    // No execution_engine set, and nothing installed: no radio is checked, none crash the page.
    expect(screen.getByRole("radio", { name: "Geth" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Geth" })).toBeDisabled();
  });

  it("saving one changed field keeps every field this page doesn't model", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ settings: OLD_SETTINGS, packages: [] });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const graffiti = screen.getByLabelText("Graffiti");
    await user.clear(graffiti);
    await user.type(graffiti, "New graffiti");

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Settings saved/);

    const saved = await api.backend.getSettings();
    expect(saved.validators_graffiti).toBe("New graffiti");
    expect(saved.some_future_field).toBe("keep-me");
    expect(saved.validators_proposer_default_fee_recipient).toBe(OLD_SETTINGS.validators_proposer_default_fee_recipient);
    // Still untouched — the page never wrote a value for fields the owner didn't change.
    expect(saved).not.toHaveProperty("mev_boost");
    expect(saved).not.toHaveProperty("execution_engine");
  });
});

describe("SettingsPage — validation", () => {
  it("requires a default fee recipient", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const feeRecipient = screen.getByLabelText("Default fee recipient");
    await user.clear(feeRecipient);

    expect(await screen.findByText("Enter a default fee recipient.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("rejects a malformed fee recipient", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const feeRecipient = screen.getByLabelText("Default fee recipient");
    await user.clear(feeRecipient);
    await user.type(feeRecipient, "not-an-address");

    expect(await screen.findByText(/Enter a valid address/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("rejects graffiti over 32 UTF-8 bytes and shows a byte counter otherwise", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    expect(screen.getByText(`${MOCK_SETTINGS.validators_graffiti?.toString().length}/32 bytes`)).toBeInTheDocument();

    const graffiti = screen.getByLabelText("Graffiti");
    await user.clear(graffiti);
    await user.type(graffiti, "x".repeat(33));

    expect(await screen.findByText(/33 bytes; the limit is 32 bytes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("Simple mode hides the peer limit and checkpoint URL entirely — they can't block Save", async () => {
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" }, { advanced: false });
    await waitForLoaded();

    expect(screen.queryByLabelText("Peer limit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Checkpoint sync URL")).not.toBeInTheDocument();
  });

  it("Advanced mode validates peer limit (positive integer) and checkpoint URL", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" }, { advanced: true });
    await waitForLoaded();

    expect(screen.getByText(/The default is 100/)).toBeInTheDocument();

    const peerLimit = screen.getByLabelText("Peer limit");
    await user.clear(peerLimit);
    await user.type(peerLimit, "-5");
    expect(await screen.findByText("Enter a positive whole number.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.clear(peerLimit);
    await user.type(peerLimit, "150");
    expect(screen.queryByText("Enter a positive whole number.")).not.toBeInTheDocument();

    const checkpointUrl = screen.getByLabelText("Checkpoint sync URL");
    await user.clear(checkpointUrl);
    await user.type(checkpointUrl, "not a url");
    expect(await screen.findByText("Enter a valid URL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });
});

describe("SettingsPage — execution client picker", () => {
  it("picking an installed candidate enables Save, and saving writes both execution_engine and ee_endpoint", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      settings: { ...MOCK_SETTINGS, execution_engine: "ethchain-geth.public.dappnode.eth", ee_endpoint: "http://ethchain-geth.my.ava.do:8551" },
      packages: [...MOCK_PACKAGES, "avado-dnp-nethermind.public.dappnode.eth"],
    });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    await user.click(screen.getByRole("radio", { name: "Nethermind" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Settings saved/);

    const saved = await api.backend.getSettings();
    expect(saved.execution_engine).toBe("avado-dnp-nethermind.public.dappnode.eth");
    expect(saved.ee_endpoint).toBe("http://avado-dnp-nethermind.my.ava.do:8551");
  });

  it("cannot pick a candidate that isn't installed", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ settings: MOCK_SETTINGS, packages: ["ethchain-geth.public.dappnode.eth"] });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const nethermind = screen.getByRole("radio", { name: "Nethermind" });
    expect(nethermind).toBeDisabled();
    await user.click(nethermind);
    expect(nethermind).not.toBeChecked();
  });

  it("warns when the currently selected engine is not installed", async () => {
    const api = createMockApi({
      settings: { ...MOCK_SETTINGS, execution_engine: "ethchain-geth.public.dappnode.eth" },
      packages: [], // nothing installed
    });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    expect(await screen.findByText(/is not installed/)).toBeInTheDocument();
  });
});

describe("SettingsPage — MEV-Boost", () => {
  it("is disabled with a link to install it when the MEV-Boost package is not installed", async () => {
    const api = createMockApi({ settings: MOCK_SETTINGS, packages: ["ethchain-geth.public.dappnode.eth"] });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const toggle = screen.getByRole("checkbox", { name: /Enable MEV-Boost/ });
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("link", { name: "Install the MEV-Boost package" })).toHaveAttribute(
      "href",
      "http://my.ava.do/#/installer",
    );
  });

  it("can be toggled and saved when the MEV-Boost package is installed", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ settings: { ...MOCK_SETTINGS, mev_boost: false }, packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const toggle = screen.getByRole("checkbox", { name: /Enable MEV-Boost/ });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    expect(toggle).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Settings saved/);
    expect((await api.backend.getSettings()).mev_boost).toBe(true);
  });

  it("is not offered at all on Gnosis", async () => {
    const api = createMockApi({ settings: { ...MOCK_SETTINGS, network: "gnosis" }, packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "gnosis" });
    await waitForLoaded();

    expect(screen.queryByText("MEV-Boost")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Enable MEV-Boost/ })).not.toBeInTheDocument();
  });
});

describe("SettingsPage — revert and save failure", () => {
  it("Revert discards unsaved edits", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const graffiti = screen.getByLabelText("Graffiti");
    await user.clear(graffiti);
    await user.type(graffiti, "Something else");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Revert changes" }));
    expect(screen.getByLabelText("Graffiti")).toHaveValue(MOCK_SETTINGS.validators_graffiti);
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("shows an error and keeps the edit when saving fails (e.g. the box is restarting)", async () => {
    const user = userEvent.setup();
    const backend: PackageBackend = {
      getSettings: vi.fn().mockResolvedValue({ ...MOCK_SETTINGS }),
      saveSettings: vi.fn().mockRejectedValue(new Error("The client is not reachable")),
      getDefaultSettings: vi.fn().mockResolvedValue({ ...MOCK_DEFAULT_SETTINGS }),
      service: vi.fn(),
      serviceStatus: vi.fn().mockResolvedValue([]),
    };
    const api: Api = {
      backend,
      beacon: createMockApi({ packages: MOCK_PACKAGES }).beacon,
      keymanager: createMockApi().keymanager,
      dappmanager: createMockApi({ packages: MOCK_PACKAGES }).dappmanager,
    };
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const graffiti = screen.getByLabelText("Graffiti");
    await user.clear(graffiti);
    await user.type(graffiti, "Something else");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save settings: The client is not reachable");
    // The edit is not lost — the owner can retry.
    expect(screen.getByLabelText("Graffiti")).toHaveValue("Something else");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
  });
});
