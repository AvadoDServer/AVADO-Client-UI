import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiProvider } from "../../../api/ApiProvider";
import { ApiError } from "../../../api/errors";
import { createMockApi, MOCK_DEFAULT_FEE_RECIPIENT, MOCK_DEFAULT_SETTINGS, MOCK_PACKAGES, MOCK_SETTINGS } from "../../../api/mock";
import type { Api, PackageBackend, Settings } from "../../../api/types";
import { ClientConfigProvider } from "../../../config/ClientConfigProvider";
import { normalizeClientConfig, type ClientConfig } from "../../../config/clientConfig";
import { MODE_STORAGE_KEY, ModeProvider, useMode } from "../../../settings/ModeProvider";
import { ROUTER_FUTURE } from "../../../App";
import { SETTINGS_SAVED_EVENT } from "../../../components/shell/events";
import SettingsPage from "../SettingsPage";

/** Lets a test flip Simple/Advanced mode mid-session, the way the shared footer's toggle would. */
function ModeToggleButton() {
  const { mode, setMode } = useMode();
  return (
    <button type="button" onClick={() => setMode(mode === "advanced" ? "simple" : "advanced")}>
      Toggle mode
    </button>
  );
}

function renderPage(
  api: Api,
  config: Partial<ClientConfig> = {},
  { advanced = false, path = "/settings" }: { advanced?: boolean; path?: string } = {},
) {
  if (advanced) localStorage.setItem(MODE_STORAGE_KEY, "advanced");
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <ClientConfigProvider config={normalizeClientConfig(config)}>
        <ApiProvider api={api}>
          <ModeProvider>
            <ModeToggleButton />
            <SettingsPage />
          </ModeProvider>
        </ApiProvider>
      </ClientConfigProvider>
    </MemoryRouter>,
  );
}

/** A backend around one settings object, like the box: POST overwrites it. */
function boxBackend(initial: Settings, save: (s: Settings, write: (s: Settings) => void) => Promise<void>): PackageBackend {
  let onDisk: Settings = { ...initial };
  return {
    getSettings: vi.fn(async () => ({ ...onDisk })),
    saveSettings: vi.fn((s: Settings) => save(s, (w) => (onDisk = { ...w }))),
    getDefaultSettings: vi.fn().mockResolvedValue({ ...MOCK_DEFAULT_SETTINGS }),
    service: vi.fn(),
    serviceStatus: vi.fn().mockResolvedValue([]),
  };
}

function apiWith(backend: PackageBackend): Api {
  const mock = createMockApi({ packages: MOCK_PACKAGES });
  return { ...mock, backend };
}

const saveTimeout = () => new ApiError({ kind: "timeout", service: "backend", path: "/settings" });

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

  // Important 2 (ruling): a field missing from an old settings.json, and untouched by the
  // owner, must not block Save — the default is shown as a hint only and is never written.
  it("an old settings.json missing the peer limit doesn't block Save until the owner edits it", async () => {
    const user = userEvent.setup();
    const OLD_SETTINGS: Settings = {
      network: "mainnet",
      validators_graffiti: "Avado",
      validators_proposer_default_fee_recipient: "0x1111111111111111111111111111111111111111",
      // No p2p_peer_upper_bound at all.
    };
    const api = createMockApi({ settings: OLD_SETTINGS, packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" }, { advanced: true });
    await waitForLoaded();

    // Shown as a hint, not pre-filled, and not an error.
    expect(screen.getByLabelText("Peer limit")).toHaveValue("");
    expect(screen.queryByText("Enter a positive whole number.")).not.toBeInTheDocument();
    expect(screen.getByText(/The default is 100/)).toBeInTheDocument();

    // Editing something else entirely must not be blocked by the untouched, missing peer limit.
    const graffiti = screen.getByLabelText("Graffiti");
    await user.clear(graffiti);
    await user.type(graffiti, "Changed");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Settings saved/);

    const saved = await api.backend.getSettings();
    expect(saved.validators_graffiti).toBe("Changed");
    expect(saved).not.toHaveProperty("p2p_peer_upper_bound"); // never written — the owner never touched it
  });
});

// Critical 1: validation and the save patch must agree regardless of which mode is currently
// rendering a field. Leaving Advanced mode must discard any edit to the fields it hides, so an
// invalid peer limit can never reach settings.json by switching to Simple mode mid-edit.
describe("SettingsPage — switching mode mid-edit can never leak an invalid Advanced field into a save", () => {
  it("discards an invalid, unsaved peer-limit edit the instant Advanced mode is left, and it's never saved", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES }); // MOCK_SETTINGS.p2p_peer_upper_bound === 100
    renderPage(api, { client: "nimbus", network: "mainnet" }, { advanced: true });
    await waitForLoaded();

    const peerLimit = screen.getByLabelText("Peer limit");
    await user.clear(peerLimit);
    await user.type(peerLimit, "not-a-number");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    // Leave Advanced mode with the invalid edit still sitting in the (now hidden) field.
    await user.click(screen.getByRole("button", { name: "Toggle mode" }));
    expect(screen.queryByLabelText("Peer limit")).not.toBeInTheDocument();
    // The edit was discarded, not just hidden: nothing is dirty, so Save is disabled for that
    // reason — not stuck disabled forever by an invisible, unresolvable error.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByText(/Fix the highlighted fields/)).not.toBeInTheDocument();

    // Re-entering Advanced mode shows the field back at its last-saved value, not the invalid one.
    await user.click(screen.getByRole("button", { name: "Toggle mode" }));
    expect(screen.getByLabelText("Peer limit")).toHaveValue(String(MOCK_SETTINGS.p2p_peer_upper_bound));

    // The box never received the invalid value at any point in this sequence.
    expect(await api.backend.getSettings()).toEqual(MOCK_SETTINGS);
  });

  it("leaving Advanced mode discards any pending peer-limit/checkpoint-URL edit — valid or not — so a hidden field never silently carries unsaved state", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ packages: MOCK_PACKAGES });
    renderPage(api, { client: "nimbus", network: "mainnet" }, { advanced: true });
    await waitForLoaded();

    const peerLimit = screen.getByLabelText("Peer limit");
    await user.clear(peerLimit);
    await user.type(peerLimit, "150"); // a perfectly valid, but not yet saved, edit

    await user.click(screen.getByRole("button", { name: "Toggle mode" })); // -> Simple
    await user.click(screen.getByRole("button", { name: "Toggle mode" })); // -> Advanced

    expect(screen.getByLabelText("Peer limit")).toHaveValue(String(MOCK_SETTINGS.p2p_peer_upper_bound));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    // Editing it again while Advanced stays open still works and saves normally.
    await user.clear(screen.getByLabelText("Peer limit"));
    await user.type(screen.getByLabelText("Peer limit"), "150");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Settings saved/);
    expect((await api.backend.getSettings()).p2p_peer_upper_bound).toBe(150);
  });
});

// Important 1: a validation-blocked Save must be explained near the buttons, not only on the
// (possibly off-screen) field itself.
describe("SettingsPage — inline message when Save is blocked by validation", () => {
  it("names the fields to fix next to Save/Revert, and a link focuses the named field", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" },
      packages: MOCK_PACKAGES,
    });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    expect(screen.getByText(/Fix the highlighted fields to save/)).toBeInTheDocument();
    const link = screen.getByRole("button", { name: "Default fee recipient" });

    await user.click(link);
    expect(screen.getByLabelText("Default fee recipient")).toHaveFocus();
  });

  it("the message and its links disappear once every listed field is fixed", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      settings: { ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "" },
      packages: MOCK_PACKAGES,
    });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const feeRecipient = screen.getByLabelText("Default fee recipient");
    await user.type(feeRecipient, MOCK_DEFAULT_FEE_RECIPIENT);

    expect(screen.queryByText(/Fix the highlighted fields to save/)).not.toBeInTheDocument();
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
  it("cannot be turned on when the MEV-Boost package is not installed and it's currently off", async () => {
    const api = createMockApi({ settings: { ...MOCK_SETTINGS, mev_boost: false }, packages: ["ethchain-geth.public.dappnode.eth"] });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const toggle = screen.getByRole("checkbox", { name: /Enable MEV-Boost/ });
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByRole("link", { name: "Install the MEV-Boost package" })).toHaveAttribute(
      "href",
      "http://my.ava.do/#/installer",
    );
  });

  // Minor fix: losing the package must not strand an already-on toggle — turning it off stays
  // possible even without the package installed; only turning it on requires it.
  it("can still be turned off when the package is no longer installed but it's currently on", async () => {
    const user = userEvent.setup();
    const api = createMockApi({ settings: { ...MOCK_SETTINGS, mev_boost: true }, packages: ["ethchain-geth.public.dappnode.eth"] });
    renderPage(api, { client: "nimbus", network: "mainnet" });
    await waitForLoaded();

    const toggle = screen.getByRole("checkbox", { name: /Enable MEV-Boost/ });
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.getByText(/no longer installed/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Install the MEV-Boost package" })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Settings saved/);
    expect((await api.backend.getSettings()).mev_boost).toBe(false);
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

describe("SettingsPage — after a save", () => {
  it("tells the shell the settings changed, so the banners update at once", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    try {
      renderPage(createMockApi({ packages: MOCK_PACKAGES }), { client: "nimbus", network: "mainnet" });
      await waitForLoaded();
      await user.clear(screen.getByLabelText("Graffiti"));
      await user.type(screen.getByLabelText("Graffiti"), "New graffiti");
      expect(onSaved).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByText(/Settings saved/)).toBeInTheDocument();
      expect(onSaved).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
    }
  });

  it("does not tell the shell anything when the save fails", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    try {
      const backend = boxBackend(MOCK_SETTINGS, async () => {
        throw new Error("refused");
      });
      renderPage(apiWith(backend), { client: "nimbus", network: "mainnet" });
      await waitForLoaded();
      await user.type(screen.getByLabelText("Graffiti"), "!");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not save settings");
      expect(onSaved).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
    }
  });

  it("a save that times out after the file was written reads the file again and says saved", async () => {
    const user = userEvent.setup();
    const backend = boxBackend(MOCK_SETTINGS, async (s, write) => {
      write(s); // written, then the restart outlasts the time limit
      throw saveTimeout();
    });
    renderPage(apiWith(backend), { client: "nimbus", network: "mainnet" });
    await waitForLoaded();
    await user.clear(screen.getByLabelText("Graffiti"));
    await user.type(screen.getByLabelText("Graffiti"), "Late graffiti");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Settings saved/)).toBeInTheDocument();
    // Read-modify-write GET, then the confirming re-read.
    expect(backend.getSettings).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/\bstarting/i)).toBeNull(); // "is restarting to use them" is fine; "is starting, try again" is not
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("a save that times out without writing keeps the edit and says it was not saved", async () => {
    const user = userEvent.setup();
    const backend = boxBackend(MOCK_SETTINGS, async () => {
      throw saveTimeout();
    });
    renderPage(apiWith(backend), { client: "nimbus", network: "mainnet" });
    await waitForLoaded();
    await user.clear(screen.getByLabelText("Graffiti"));
    await user.type(screen.getByLabelText("Graffiti"), "Lost graffiti");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("your changes are not in the settings file");
    expect(screen.getByLabelText("Graffiti")).toHaveValue("Lost graffiti");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("a save that times out when the file can't be read again says so, without claiming either way", async () => {
    const user = userEvent.setup();
    const backend = boxBackend(MOCK_SETTINGS, async () => {
      (backend.getSettings as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("restarting"));
      throw saveTimeout();
    });
    renderPage(apiWith(backend), { client: "nimbus", network: "mainnet" });
    await waitForLoaded();
    await user.type(screen.getByLabelText("Graffiti"), "!");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("isn't clear yet whether your changes were saved");
    expect(screen.queryByText(/Settings saved/)).toBeNull();
  });
});

describe("SettingsPage — the settings on the box changed or couldn't be read (final review I1)", () => {
  it("refuses to save over settings changed elsewhere since the page loaded, and asks to reload", async () => {
    const user = userEvent.setup();
    const backend = boxBackend(MOCK_SETTINGS, async (s, write) => write(s));
    renderPage(apiWith(backend), { client: "nimbus", network: "mainnet" });
    await waitForLoaded();
    // Another tab changes the fee recipient after this page loaded.
    await backend.saveSettings({ ...MOCK_SETTINGS, validators_proposer_default_fee_recipient: "0x2222222222222222222222222222222222222222" });
    (backend.saveSettings as ReturnType<typeof vi.fn>).mockClear();

    await user.clear(screen.getByLabelText("Graffiti"));
    await user.type(screen.getByLabelText("Graffiti"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your settings changed or couldn't be read — reload and try again");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(backend.saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByText(/Settings saved/)).toBeNull();
    expect(screen.getByLabelText("Graffiti")).toHaveValue("Mine");
  });

  it("refuses to save when the backend answers the re-read with its defaults (settings.json unreadable)", async () => {
    const user = userEvent.setup();
    const backend = boxBackend(MOCK_SETTINGS, async (s, write) => write(s));
    renderPage(apiWith(backend), { client: "nimbus", network: "mainnet" });
    await waitForLoaded();
    // The deno backend falls back to defaultsettings() on a read/parse failure.
    (backend.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ...MOCK_DEFAULT_SETTINGS });

    await user.clear(screen.getByLabelText("Graffiti"));
    await user.type(screen.getByLabelText("Graffiti"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your settings changed or couldn't be read — reload and try again");
    expect(backend.saveSettings).not.toHaveBeenCalled();
  });
});

describe("SettingsPage — opened from the fee-recipient banner", () => {
  it("?focus=fee-recipient focuses the default fee recipient field once loaded", async () => {
    renderPage(createMockApi({ packages: MOCK_PACKAGES }), { client: "nimbus", network: "mainnet" }, { path: "/settings?focus=fee-recipient" });
    await waitForLoaded();
    await waitFor(() => expect(screen.getByLabelText("Default fee recipient")).toHaveFocus());
  });

  it("without the parameter nothing is focused", async () => {
    renderPage(createMockApi({ packages: MOCK_PACKAGES }), { client: "nimbus", network: "mainnet" });
    await waitForLoaded();
    expect(screen.getByLabelText("Default fee recipient")).not.toHaveFocus();
  });
});
