import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMockApi, fakeHex } from "../../../api/mock";
import { mockLidoDepositData } from "../../../api/mockLido";
import type { Api } from "../../../api/types";
import { LIDO_NETWORKS } from "../../../lib/lido";
import { fakeKeystore, renderWithApi } from "../../validators/__tests__/renderWithApi";
import AddValidatorsPage from "../AddValidatorsPage";

const VAULT = LIDO_NETWORKS.mainnet!.elRewardsVault;
const PK = [fakeHex(601, 48), fakeHex(602, 48), fakeHex(603, 48)];
const keyFile = (name: string, pubkey: string) => new File([fakeKeystore(pubkey)], name, { type: "application/json" });
const depositFile = (pubkeys: string[], name = "deposit_data-1.json") =>
  new File([mockLidoDepositData(pubkeys)], name, { type: "application/json" });

function renderPage(config = {}): Api {
  const api = createMockApi({ keystores: [] });
  renderWithApi(<AddValidatorsPage />, api, config);
  return api;
}

const fileRow = (name: string) => {
  const el = screen.getByRole("list", { name: "Selected files" }).querySelector<HTMLElement>(`li[data-file="${name}"]`);
  if (!el) throw new Error(`no row for ${name}`);
  return within(el);
};

async function pick(files: File[]) {
  await userEvent.upload(screen.getByLabelText("Choose keystore files"), files);
  await screen.findByRole("list", { name: "Selected files" });
}

describe("AddValidatorsPage with Lido CSM keys", () => {
  it("mentions the deposit data file for Lido keys on mainnet only", () => {
    renderPage();
    expect(screen.getByText(/For Lido CSM keys, add the deposit data file/)).toBeInTheDocument();
  });

  it("doesn't mention Lido on networks without Lido", () => {
    renderPage({ network: "gnosis" });
    expect(screen.queryByText(/Lido/)).toBeNull();
  });

  it("imports the keys and sends the Lido ones' block rewards to Lido", async () => {
    const api = renderPage();
    const set = vi.spyOn(api.keymanager, "setFeeRecipient");
    // PK[2] is the owner's own key: not in the deposit data file.
    await pick([keyFile("a.json", PK[0]), keyFile("b.json", PK[1]), keyFile("own.json", PK[2]), depositFile([PK[0], PK[1]])]);
    expect(fileRow("deposit_data-1.json").getByText("Lido")).toBeInTheDocument();
    expect(fileRow("deposit_data-1.json").getByText(/the 2 keys in it will send their block rewards to Lido/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Keystore password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Import 3 keys" }));
    expect(await screen.findByText("2 keys now send their block rewards to Lido.")).toBeInTheDocument();
    expect(set).toHaveBeenCalledTimes(2);
    expect(await api.keymanager.getFeeRecipient(PK[0])).toBe(VAULT);
    expect(await api.keymanager.getFeeRecipient(PK[1])).toBe(VAULT);
    expect(set).not.toHaveBeenCalledWith(PK[2], expect.anything());
  });

  it("sets Lido's address when the deposit data file comes after the import", async () => {
    const api = renderPage();
    await pick([keyFile("a.json", PK[0])]);
    await userEvent.type(screen.getByLabelText("Keystore password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    await screen.findByText("1 imported.");
    await userEvent.upload(screen.getByLabelText("Choose keystore files"), [depositFile([PK[0]])]);
    expect(await screen.findByText("1 key now sends its block rewards to Lido.")).toBeInTheDocument();
    expect(await api.keymanager.getFeeRecipient(PK[0])).toBe(VAULT);
  });

  it("says when a key didn't get Lido's address and links to the Lido page", async () => {
    const api = renderPage();
    vi.spyOn(api.keymanager, "setFeeRecipient").mockRejectedValue(new Error("the client is restarting"));
    await pick([keyFile("a.json", PK[0]), depositFile([PK[0]])]);
    await userEvent.type(screen.getByLabelText("Keystore password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    expect(await screen.findByText(/1 key didn.t get Lido.s address: the client is restarting/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix it on the Lido CSM page" })).toHaveAttribute("href", "/lido");
  });

  it("warns about a deposit data file for another network and sets nothing", async () => {
    const api = renderPage({ network: "hoodi" });
    const set = vi.spyOn(api.keymanager, "setFeeRecipient");
    await pick([keyFile("a.json", PK[0]), depositFile([PK[0]])]);
    expect(fileRow("deposit_data-1.json").getByText(/is for mainnet, but this node runs on hoodi/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Keystore password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    await screen.findByText("1 imported.");
    await waitFor(() => expect(set).not.toHaveBeenCalled());
  });
});
