import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApi, MOCK_DEFAULT_FEE_RECIPIENT, MOCK_PUBKEYS } from "../../../api/mock";
import type { Api } from "../../../api/types";
import ValidatorsPage from "../ValidatorsPage";
import { renderWithApi } from "./renderWithApi";

const downloads = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; text: string; successShown: boolean }>,
  /** How many of the next downloads throw. */
  failNext: 0,
}));
vi.mock("../../../lib/download", () => ({
  downloadText: (name: string, text: string) => {
    if (downloads.failNext > 0) {
      downloads.failNext -= 1;
      throw new Error("Download blocked");
    }
    downloads.calls.push({
      name,
      text,
      // Was success already on screen when the file was saved?
      successShown: !!document.body.textContent?.includes(" removed"),
    });
  },
}));

const NEW_ADDR = "0x1111111111111111111111111111111111111111";

async function table() {
  return within(await screen.findByRole("table", { name: "Validators" }));
}

function rowOf(pubkey: string): HTMLElement {
  const el = screen.getByRole("table").querySelector<HTMLElement>(`tr[data-pubkey="${pubkey}"]`);
  if (!el) throw new Error(`no table row for ${pubkey}`);
  return el;
}

function renderPage(api: Api = createMockApi(), props = {}) {
  renderWithApi(<ValidatorsPage {...props} />, api);
  return api;
}

beforeEach(() => {
  downloads.calls = [];
  downloads.failNext = 0;
});

describe("ValidatorsPage", () => {
  it("lists every key with its status and withdrawal state in plain words", async () => {
    renderPage();
    const t = await table();
    await waitFor(() => expect(t.getAllByRole("row")).toHaveLength(6)); // header + 5 keys

    expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Active")).toBeInTheDocument();
    expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Withdrawal address set")).toBeInTheDocument();
    expect(within(rowOf(MOCK_PUBKEYS.active02)).getByText(/compounding/)).toBeInTheDocument();
    expect(within(rowOf(MOCK_PUBKEYS.active00)).getByText("Needs a withdrawal address")).toBeInTheDocument();
    expect(within(rowOf(MOCK_PUBKEYS.pendingQueued)).getByText("Waiting to activate")).toBeInTheDocument();
    expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("32.0135 ETH")).toBeInTheDocument();

    // Fee recipients: the default and the override for active02.
    expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Default")).toBeInTheDocument();
    expect(within(rowOf(MOCK_PUBKEYS.active02)).getByText("Custom")).toBeInTheDocument();

    // Sorted by index, the unknown key last.
    const order = t
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.getAttribute("data-pubkey"));
    expect(order).toEqual([
      MOCK_PUBKEYS.active00,
      MOCK_PUBKEYS.active01,
      MOCK_PUBKEYS.active02,
      MOCK_PUBKEYS.pendingQueued,
      MOCK_PUBKEYS.unknown,
    ]);

    // Links go to beaconcha.in pages; nothing calls its API.
    const link = within(rowOf(MOCK_PUBKEYS.active01)).getByRole("link", { name: /412345/ });
    expect(link).toHaveAttribute("href", `https://beaconcha.in/validator/${MOCK_PUBKEYS.active01}`);
    expect(screen.getByRole("link", { name: /beaconcha.in dashboard/ }).getAttribute("href")).toContain("validators=98765,412345,1203311,1987654");

    // Phone cards carry the same content.
    const cards = within(screen.getByRole("list", { name: "Validators" }));
    expect(cards.getAllByRole("listitem")).toHaveLength(5);
  });

  it("shows a key the beacon node doesn't know (404) as Waiting for deposit, not an error (review focus 3)", async () => {
    const api = createMockApi();
    const spy = vi.spyOn(api.beacon, "validator");
    renderPage(api);
    await table();
    const row = await waitFor(() => rowOf(MOCK_PUBKEYS.unknown));
    await waitFor(() => expect(within(row).getByText("Waiting for deposit")).toBeInTheDocument());
    expect(within(row).getByText("New key")).toBeInTheDocument();
    await expect(spy.mock.results.find((_r, i) => spy.mock.calls[i][0] === MOCK_PUBKEYS.unknown)!.value).resolves.toBeNull();
    // No exit for it, and no error anywhere.
    expect(within(row).queryByRole("button", { name: /^Exit/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/isn't answering/)).toBeNull();
    // The other keys still show normally.
    expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Active")).toBeInTheDocument();
  });

  it("says the status is not available when the beacon call fails, without hiding the key", async () => {
    const api = createMockApi();
    vi.spyOn(api.beacon, "validator").mockRejectedValue(new Error("connect ECONNREFUSED"));
    renderPage(api);
    await table();
    await waitFor(() => expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Status not available")).toBeInTheDocument());
  });

  it("shows Nimbus is starting while the keymanager is down and recovers without a reload", async () => {
    const api = createMockApi();
    await api.backend.service("stop");
    renderPage(api, { retryMs: 30 });
    expect(await screen.findByRole("heading", { name: "Nimbus is starting" })).toBeInTheDocument();
    await api.backend.service("start");
    await table();
    expect(screen.queryByRole("heading", { name: "Nimbus is starting" })).toBeNull();
  });

  it("keeps the last known list when a refresh fails", async () => {
    const api = createMockApi();
    renderPage(api, { pollMs: 30, retryMs: 30 });
    await table();
    await api.backend.service("stop");
    expect(await screen.findByText(/isn't answering right now/)).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    await api.backend.service("start");
    await waitFor(() => expect(screen.queryByText(/isn't answering right now/)).toBeNull());
  });

  it("shows an empty state that leads to Add validators", async () => {
    renderPage(createMockApi({ keystores: [] }));
    expect(await screen.findByRole("heading", { name: "No validators yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add validators" })).toHaveAttribute("href", "/add"); // a router Link: "#/add" under the app's HashRouter
  });

  describe("fee recipient", () => {
    it("sets an override", async () => {
      const api = renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Change fee recipient of Validator 412345" }));
      const dialog = await screen.findByRole("dialog", { name: "Fee recipient" });
      expect(within(dialog).getByText(MOCK_DEFAULT_FEE_RECIPIENT)).toBeInTheDocument();
      await userEvent.type(within(dialog).getByLabelText("Address for this validator"), NEW_ADDR);
      await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active01)).toBe(NEW_ADDR);
      await waitFor(() => expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Custom")).toBeInTheDocument());
    });

    it("rejects an invalid address", async () => {
      const api = renderPage();
      const set = vi.spyOn(api.keymanager, "setFeeRecipient");
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Change fee recipient of Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText("Address for this validator"), "0x1234");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(await within(dialog).findByText(/Enter an Ethereum address/)).toBeInTheDocument();
      expect(set).not.toHaveBeenCalled();
    });

    it("clears an override back to the default", async () => {
      const api = renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Change fee recipient of Validator 1203311" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Use the default" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(await api.keymanager.getFeeRecipient(MOCK_PUBKEYS.active02)).toBe(MOCK_DEFAULT_FEE_RECIPIENT);
      await waitFor(() => expect(within(rowOf(MOCK_PUBKEYS.active02)).getByText("Default")).toBeInTheDocument());
    });
  });

  describe("remove", () => {
    it("saves the slashing protection as slashing-protection-<pk8>.json before confirming success", async () => {
      const api = renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      const dialog = await screen.findByRole("dialog", { name: "Remove Validator 412345?" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Remove validator" }));

      expect(await screen.findByRole("dialog", { name: "Validator 412345 removed" })).toBeInTheDocument();
      const file = `slashing-protection-${MOCK_PUBKEYS.active01.slice(2, 10)}.json`;
      expect(downloads.calls).toHaveLength(1);
      expect(downloads.calls[0].name).toBe(file);
      expect(downloads.calls[0].successShown).toBe(false);
      expect(JSON.parse(downloads.calls[0].text).data[0].pubkey).toBe(MOCK_PUBKEYS.active01);
      expect(screen.getByText(file)).toBeInTheDocument();
      expect(screen.getByText(/should have saved/)).toBeInTheDocument();

      expect((await api.keymanager.listKeystores()).map((k) => k.validating_pubkey)).not.toContain(MOCK_PUBKEYS.active01);
      await waitFor(() => expect(screen.getByRole("table").querySelector(`tr[data-pubkey="${MOCK_PUBKEYS.active01}"]`)).toBeNull());
    });

    it("keeps the dialog open with Download again, and moves focus to the heading when closed", async () => {
      renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove validator" }));
      const done = await screen.findByRole("dialog", { name: "Validator 412345 removed" });
      // The list refreshes underneath; the dialog stays.
      await waitFor(() => expect(screen.getByRole("table").querySelector(`tr[data-pubkey="${MOCK_PUBKEYS.active01}"]`)).toBeNull());
      expect(screen.getByRole("dialog", { name: "Validator 412345 removed" })).toBeInTheDocument();
      await userEvent.click(within(done).getByRole("button", { name: "Download again" }));
      expect(downloads.calls).toHaveLength(2);
      await userEvent.click(within(done).getByRole("button", { name: "I have the file" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(screen.getByRole("heading", { name: "Validators", level: 1 })).toHaveFocus());
    });

    it("warns when the browser didn't save the file and doesn't claim it was saved", async () => {
      downloads.failNext = 1;
      renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove validator" }));
      const done = await screen.findByRole("dialog", { name: "Validator 412345 removed" });
      expect(within(done).getByRole("alert")).toHaveTextContent("Your browser didn't save the slashing-protection file");
      expect(within(done).queryByText(/should have saved/)).toBeNull();
      expect(within(done).queryByText(/was saved/)).toBeNull();
      // Download again is the primary action; the dialog can't be dismissed by Escape or the close button.
      expect(within(done).queryByRole("button", { name: "Close dialog" })).toBeNull();
      expect(within(done).queryByRole("button", { name: "I have the file" })).toBeNull();
      await userEvent.keyboard("{Escape}");
      expect(screen.getByRole("dialog", { name: "Validator 412345 removed" })).toBeInTheDocument();

      await userEvent.click(within(done).getByRole("button", { name: "Download again" }));
      expect(downloads.calls).toHaveLength(1);
      expect(downloads.calls[0].name).toBe(`slashing-protection-${MOCK_PUBKEYS.active01.slice(2, 10)}.json`);
      expect(within(done).queryByRole("alert")).toBeNull();
      expect(within(done).getByText(/should have saved/)).toBeInTheDocument();
      expect(within(done).getByRole("button", { name: "I have the file" })).toBeInTheDocument();
    });

    it("can still be closed without the file after a failed download", async () => {
      downloads.failNext = 5;
      renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove validator" }));
      const done = await screen.findByRole("dialog", { name: "Validator 412345 removed" });
      await userEvent.click(within(done).getByRole("button", { name: "Download again" }));
      expect(within(done).getByRole("alert")).toBeInTheDocument();
      await userEvent.click(within(done).getByRole("button", { name: "Close without the file" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("a removal without a slashing-protection file is still reported as removed, and says the file is missing", async () => {
      const api = createMockApi();
      vi.spyOn(api.keymanager, "deleteKeystores").mockResolvedValue({ data: [{ status: "deleted" }] });
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove validator" }));
      const done = await screen.findByRole("dialog", { name: "Validator 412345 removed" });
      expect(within(done).getByText("The node didn't return a slashing-protection file for this key.")).toBeInTheDocument();
      expect(screen.queryByText(/The key was not removed/)).toBeNull();
      expect(downloads.calls).toHaveLength(0);
    });

    it("a per-key error status without a slashing-protection file says the key was not removed", async () => {
      const api = createMockApi();
      vi.spyOn(api.keymanager, "deleteKeystores").mockResolvedValue({ data: [{ status: "error", message: "locked" }] });
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Remove validator" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("The key was not removed: locked.");
    });

    it("does not report success when the keymanager fails", async () => {
      const api = createMockApi();
      vi.spyOn(api.keymanager, "deleteKeystores").mockRejectedValue(new Error("HTTP 500"));
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Remove Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: "Remove validator" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("The key was not removed: HTTP 500");
      expect(downloads.calls).toHaveLength(0);
    });
  });

  describe("voluntary exit", () => {
    it("is offered only for active validators", async () => {
      renderPage();
      const t = await table();
      await t.findByRole("button", { name: "Exit Validator 412345" });
      expect(t.queryByRole("button", { name: "Exit Validator 1987654" })).toBeNull();
    });

    it("needs the validator index typed, warns it's permanent, then signs and submits", async () => {
      const api = renderPage();
      const sign = vi.spyOn(api.keymanager, "signVoluntaryExit");
      const submit = vi.spyOn(api.beacon, "submitVoluntaryExit");
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 412345" }));
      const dialog = await screen.findByRole("dialog", { name: "Exit validator 412345?" });
      expect(within(dialog).getByText(/permanent and can't be undone/)).toBeInTheDocument();

      const confirm = within(dialog).getByRole("button", { name: "Exit validator" });
      expect(confirm).toBeDisabled();
      const input = within(dialog).getByLabelText(/Type the validator index/);
      await userEvent.type(input, "agree");
      expect(confirm).toBeDisabled();
      await userEvent.clear(input);
      await userEvent.type(input, "41234");
      expect(confirm).toBeDisabled();
      await userEvent.type(input, "5");
      expect(confirm).toBeEnabled();
      await userEvent.click(confirm);

      expect(await screen.findByRole("dialog", { name: "Exit submitted for validator 412345" })).toBeInTheDocument();
      expect(sign).toHaveBeenCalledWith(MOCK_PUBKEYS.active01);
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ message: expect.objectContaining({ validator_index: "412345" }) }));
      await waitFor(() => expect(within(rowOf(MOCK_PUBKEYS.active01)).getByText("Exiting")).toBeInTheDocument());
    });

    it("sends nothing when the signed exit is for another validator", async () => {
      const api = createMockApi();
      vi.spyOn(api.keymanager, "signVoluntaryExit").mockResolvedValue({ message: { epoch: "1", validator_index: "999" }, signature: "0x00" });
      const submit = vi.spyOn(api.beacon, "submitVoluntaryExit");
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText(/Type the validator index/), "412345");
      await userEvent.click(within(dialog).getByRole("button", { name: "Exit validator" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("The signed exit is for validator 999, not 412345. Nothing was sent.");
      expect(submit).not.toHaveBeenCalled();
    });

    it("shows a signing error and submits nothing", async () => {
      const api = createMockApi();
      vi.spyOn(api.keymanager, "signVoluntaryExit").mockRejectedValue(new Error("HTTP 500"));
      const submit = vi.spyOn(api.beacon, "submitVoluntaryExit");
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText(/Type the validator index/), "412345");
      await userEvent.click(within(dialog).getByRole("button", { name: "Exit validator" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("The exit message could not be signed: HTTP 500");
      expect(submit).not.toHaveBeenCalled();
    });

    it("ignores Enter with a wrong index", async () => {
      const api = createMockApi();
      const sign = vi.spyOn(api.keymanager, "signVoluntaryExit");
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText(/Type the validator index/), "412344{Enter}");
      expect(sign).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Exit validator 412345?" })).toBeInTheDocument();
    });

    it("signs and submits once even when confirmed twice quickly", async () => {
      const api = createMockApi();
      const sign = vi.spyOn(api.keymanager, "signVoluntaryExit");
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      const input = within(dialog).getByLabelText(/Type the validator index/);
      await userEvent.type(input, "412345");
      const form = input.closest("form")!;
      // Both in one batch, so React has no chance to re-render with `busy` in between.
      act(() => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(await screen.findByRole("dialog", { name: "Exit submitted for validator 412345" })).toBeInTheDocument();
      expect(sign).toHaveBeenCalledTimes(1);
    });

    it("warns that a 0x00 validator's balance stays locked", async () => {
      renderPage();
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 98765" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/balance stays locked/)).toBeInTheDocument();
    });

    it("shows the beacon node's refusal and keeps the dialog open", async () => {
      const api = createMockApi();
      vi.spyOn(api.beacon, "submitVoluntaryExit").mockRejectedValue(new Error("validator has not been active long enough"));
      renderPage(api);
      const t = await table();
      await userEvent.click(await t.findByRole("button", { name: "Exit Validator 412345" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.type(within(dialog).getByLabelText(/Type the validator index/), "412345");
      await userEvent.click(within(dialog).getByRole("button", { name: "Exit validator" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "The beacon node didn't accept the exit: validator has not been active long enough",
      );
    });
  });
});
