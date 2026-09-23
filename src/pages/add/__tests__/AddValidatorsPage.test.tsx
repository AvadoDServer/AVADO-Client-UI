import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "../../../api/errors";
import { createMockApi, fakeHex, MOCK_PUBKEYS } from "../../../api/mock";
import type { Api } from "../../../api/types";
import { fakeKeystore, renderWithApi } from "../../validators/__tests__/renderWithApi";
import AddValidatorsPage from "../AddValidatorsPage";

const keyFile = (name: string, pubkey: string) => new File([fakeKeystore(pubkey)], name, { type: "application/json" });
const slashingFile = (name = "slashing.json") =>
  new File([JSON.stringify({ metadata: { interchange_format_version: "5", genesis_validators_root: "0x00" }, data: [] })], name, {
    type: "application/json",
  });

const PK = [fakeHex(501, 48), fakeHex(502, 48), fakeHex(503, 48)];

function renderPage(api: Api = createMockApi({ keystores: [] }), config = {}) {
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

describe("AddValidatorsPage", () => {
  it("imports several files with one password and shows the result per file", async () => {
    const api = renderPage();
    const importSpy = vi.spyOn(api.keymanager, "importKeystores");
    await pick([keyFile("a.json", PK[0]), keyFile("b.json", PK[1])]);
    await userEvent.type(screen.getByLabelText("Keystore password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Import 2 keys" }));

    expect(await screen.findByText("2 imported.")).toBeInTheDocument();
    expect(fileRow("a.json").getByText("Imported")).toBeInTheDocument();
    expect(fileRow("b.json").getByText("Imported")).toBeInTheDocument();
    expect(importSpy).toHaveBeenCalledWith({ keystores: [expect.any(String), expect.any(String)], passwords: ["secret123", "secret123"] });
    const keys = (await api.keymanager.listKeystores()).map((k) => k.validating_pubkey);
    expect(keys).toEqual(expect.arrayContaining([PK[0], PK[1]]));
    expect(screen.getByRole("link", { name: "See your validators" })).toHaveAttribute("href", "/"); // a router Link: "#/" under the app's HashRouter
  });

  it("with a wrong password for some files, reports each file right and keeps the successes (review focus 4)", async () => {
    const api = createMockApi({ keystores: [MOCK_PUBKEYS.active01] });
    renderPage(api);
    const importSpy = vi.spyOn(api.keymanager, "importKeystores");
    await pick([keyFile("good.json", PK[0]), keyFile("bad.json", PK[1]), keyFile("dup.json", MOCK_PUBKEYS.active01), keyFile("good2.json", PK[2])]);

    await userEvent.click(screen.getByLabelText("A password for each file"));
    await userEvent.type(screen.getByLabelText("Password for good.json"), "right");
    await userEvent.type(screen.getByLabelText("Password for bad.json"), "wrong");
    await userEvent.type(screen.getByLabelText("Password for dup.json"), "right");
    await userEvent.type(screen.getByLabelText("Password for good2.json"), "right");
    await userEvent.click(screen.getByRole("button", { name: "Import 4 keys" }));

    expect(await screen.findByText("2 imported, 1 already on this node, 1 failed.")).toBeInTheDocument();
    expect(fileRow("good.json").getByText("Imported")).toBeInTheDocument();
    expect(fileRow("good2.json").getByText("Imported")).toBeInTheDocument();
    expect(fileRow("dup.json").getByText("Already on this node")).toBeInTheDocument();
    expect(fileRow("bad.json").getByText("Wrong password")).toBeInTheDocument();
    expect(screen.getByText(/imported stay imported/)).toBeInTheDocument();

    // The successes are on the node and stay there.
    let keys = (await api.keymanager.listKeystores()).map((k) => k.validating_pubkey);
    expect(keys).toEqual(expect.arrayContaining([PK[0], PK[2], MOCK_PUBKEYS.active01]));
    expect(keys).not.toContain(PK[1]);

    // Retrying sends only the failed file, with its corrected password.
    await userEvent.clear(screen.getByLabelText("Password for bad.json"));
    await userEvent.type(screen.getByLabelText("Password for bad.json"), "fixed");
    expect(screen.queryByLabelText("Password for good.json")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    expect(await screen.findByText("1 imported.")).toBeInTheDocument();
    expect(importSpy).toHaveBeenLastCalledWith({ keystores: [expect.stringContaining(PK[1].slice(2))], passwords: ["fixed"] });
    expect(fileRow("good.json").getByText("Imported")).toBeInTheDocument();
    expect(fileRow("bad.json").getByText("Imported")).toBeInTheDocument();
    keys = (await api.keymanager.listKeystores()).map((k) => k.validating_pubkey);
    expect(keys).toEqual(expect.arrayContaining([PK[0], PK[1], PK[2]]));
  });

  it("marks every file failed, without claiming success, when the request fails", async () => {
    const api = createMockApi({ keystores: [] });
    vi.spyOn(api.keymanager, "importKeystores").mockRejectedValue(new Error("HTTP 502"));
    renderPage(api);
    await pick([keyFile("a.json", PK[0]), keyFile("b.json", PK[1])]);
    await userEvent.type(screen.getByLabelText("Keystore password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Import 2 keys" }));
    expect(await screen.findByText("2 failed.")).toBeInTheDocument();
    expect(fileRow("a.json").getByText("Not imported")).toBeInTheDocument();
    expect(fileRow("a.json").getByText("Not imported: HTTP 502")).toHaveClass("break-words");
  });

  it("on a timeout, marks each file Unknown (not failed) and checks the node's list (final review M4)", async () => {
    const api = createMockApi({ keystores: [] });
    const realImport = api.keymanager.importKeystores.bind(api.keymanager);
    // The node imports a.json, then the request runs past the time limit.
    vi.spyOn(api.keymanager, "importKeystores").mockImplementation(async (req) => {
      await realImport({ keystores: [req.keystores[0]], passwords: [req.passwords[0]] });
      throw new ApiError({ kind: "timeout", service: "keymanager", path: "/eth/v1/keystores" });
    });
    const list = vi.spyOn(api.keymanager, "listKeystores");
    renderPage(api);
    await pick([keyFile("a.json", PK[0]), keyFile("b.json", PK[1])]);
    await userEvent.type(screen.getByLabelText("Keystore password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "Import 2 keys" }));

    // The list is read right after the timeout: a.json is on the node, b.json unknown.
    expect(await fileRow("a.json").findByText("On this node")).toBeInTheDocument();
    expect(list).toHaveBeenCalled();
    expect(fileRow("b.json").getByText("Unknown")).toBeInTheDocument();
    expect(fileRow("b.json").getByText("Unknown — the node may still be importing; refresh the list")).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).toBeNull();
    expect(screen.queryByText("Not imported")).toBeNull();
    expect(screen.getByText(/didn't answer in time/)).toBeInTheDocument();

    // The node finishes b.json; refreshing the list picks it up.
    await realImport({ keystores: [fakeKeystore(PK[1])], passwords: ["secret123"] });
    await userEvent.click(screen.getByRole("button", { name: "Refresh the list" }));
    expect(await fileRow("b.json").findByText("On this node")).toBeInTheDocument();
    expect(screen.queryByText(/didn't answer in time/)).toBeNull();
    expect(screen.getByRole("link", { name: "See your validators" })).toBeInTheDocument();
  });

  it("accepts dropped files, sends the slashing protection and skips deposit data", async () => {
    const api = renderPage();
    const importSpy = vi.spyOn(api.keymanager, "importKeystores");
    const deposit = new File([JSON.stringify([{ pubkey: "ab", deposit_data_root: "cd" }])], "deposit_data-1.json");
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [keyFile("a.json", PK[0]), slashingFile(), deposit] } });
    await screen.findByRole("list", { name: "Selected files" });
    expect(screen.getByText(/slashing.json is a slashing-protection file/)).toBeInTheDocument();
    expect(fileRow("deposit_data-1.json").getByText("Skipped")).toBeInTheDocument();
    expect(fileRow("deposit_data-1.json").getByText(/deposit data file/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Keystore password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Import key" }));
    expect(await screen.findByText("1 imported.")).toBeInTheDocument();
    expect(importSpy).toHaveBeenCalledWith(
      expect.objectContaining({ keystores: [expect.any(String)], passwords: ["pw"], slashing_protection: expect.stringContaining("interchange_format_version") }),
    );
  });

  it("says so when a second slashing-protection file replaces the first", async () => {
    renderPage();
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [slashingFile()] } });
    expect(await screen.findByText(/slashing.json is a slashing-protection file, so it was added/)).toBeInTheDocument();
    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [slashingFile("old-node.json")] } });
    expect(await screen.findByText("old-node.json is a slashing-protection file. It replaces slashing.json.")).toBeInTheDocument();
    expect(screen.getByText("old-node.json")).toBeInTheDocument();
  });

  it("explains a wrong slashing-protection file in plain words", async () => {
    renderPage();
    await userEvent.upload(screen.getByLabelText("Choose slashing-protection file"), keyFile("a.json", PK[0]));
    const note = await screen.findByText(/a.json isn't a slashing-protection file/);
    expect(note.textContent).toContain("exported from your old node");
    expect(note.textContent).not.toMatch(/EIP/);
  });

  it("leaves out a second file with the same key", async () => {
    renderPage();
    await pick([keyFile("a.json", PK[0]), keyFile("a-copy.json", PK[0])]);
    expect(screen.getByText(/a-copy.json has the same key/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import key" })).toBeDisabled();
  });

  it("needs a password before importing", async () => {
    renderPage();
    await pick([keyFile("a.json", PK[0])]);
    const btn = screen.getByRole("button", { name: "Import key" });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Keystore password"), "p");
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("imports one file at a time when the client has no batch import", async () => {
    renderPage(createMockApi({ keystores: [] }), { features: { batchImport: false } });
    const input = screen.getByLabelText("Choose a keystore file");
    expect(input).not.toHaveAttribute("multiple");
    expect(screen.queryByLabelText("A password for each file")).toBeNull();
  });
});
