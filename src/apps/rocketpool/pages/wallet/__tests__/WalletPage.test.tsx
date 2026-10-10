import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RpApiError } from "../../../api/errors";
import { DEMO, DemoSnError } from "../../../api/fixtures";
import { createMockRocketpoolApi } from "../../../api/mock";
import { REVOKE_AFTER_MS } from "../../../lib/download";
import { mockDownloads, renderPage } from "../../__tests__/renderPage";
import { BACKUP_WARNING, MAYBE_PHRASE_WARNING, NEVER_SEND, RESTORE_TEXT } from "../DownloadBackup";

const dialog = () => screen.getByRole("dialog");
const downloadPosts = (posts: () => Array<{ path: string; params: Record<string, unknown> }>) =>
  posts().filter((p) => p.path === "/api/avado/backups/download");

describe("Wallet page", () => {
  it("shows the node wallet, its balances and where rewards go", async () => {
    renderPage("/wallet", { scenario: "minipool" });
    const wallet = await screen.findByTestId("node-wallet", {}, { timeout: 3000 });
    expect(within(wallet).getByText(DEMO.nodeAddress)).toBeInTheDocument();
    expect(await within(wallet).findByText("0.4128 ETH")).toBeInTheDocument();
    expect(within(wallet).getByText("12.5 RPL")).toBeInTheDocument();
    expect(within(wallet).getByText("Rocket Pool's own token.")).toBeInTheDocument();
    expect(screen.getByText("Withdrawal address").nextElementSibling).toHaveTextContent(DEMO.coldWallet);
  });

  it("a withdrawal address that is still the node wallet links to the setup step that sets one", async () => {
    renderPage("/wallet", { scenario: "mixed" });
    expect(await screen.findByText(/This is still the node wallet/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "set one" })).toHaveAttribute("href", "/setup/withdrawal");
  });

  it("one click to a fresh backup: one plain warning, no typing, one Download; the file goes straight to the downloads", async () => {
    const { posts } = renderPage("/wallet", { scenario: "minipool" });
    const saved = mockDownloads();
    try {
      await userEvent.click(await screen.findByRole("button", { name: "Download backup" }, { timeout: 3000 }));
      const d = screen.getByRole("dialog", { name: "Download backup" });
      expect(d).toHaveTextContent(BACKUP_WARNING);
      expect(BACKUP_WARNING).toContain("Keep it somewhere safe and offline; anyone with it can move your funds.");
      // What the file is for, and never "send it to support".
      expect(d).toHaveTextContent(RESTORE_TEXT);
      expect(RESTORE_TEXT).toBe("If your AVADO breaks, this file lets you move your Rocket Pool node to a new AVADO. Contact support@ava.do for the steps.");
      expect(d).toHaveTextContent(NEVER_SEND);
      expect(NEVER_SEND).toBe("Never send this file to anyone — AVADO support will never ask for it.");
      expect(d).not.toHaveTextContent(/support can bring/i);
      expect(within(d).queryByRole("textbox")).toBeNull();
      expect(downloadPosts(posts)).toHaveLength(0); // nothing before the owner presses Download

      await userEvent.click(within(d).getByRole("button", { name: "Download" }));
      const done = await screen.findByRole("dialog", { name: "Backup downloaded" });
      const fileName = `avado-rocketpool-backup-${DEMO.nodeAddress.slice(2, 10).toLowerCase()}-20260923.zip`;
      expect(done).toHaveTextContent(fileName);
      expect(downloadPosts(posts)).toEqual([{ method: "POST", path: "/api/avado/backups/download", params: { name: "current" } }]);
      // Fetched as a blob and saved through an object URL, which is revoked shortly after.
      expect(saved.names).toEqual([fileName]);
      expect(saved.blobs[0].size).toBe(22);
      await waitFor(() => expect(saved.revoked).toEqual(["blob:demo-1"]), { timeout: REVOKE_AFTER_MS + 2000 });

      await userEvent.click(within(done).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      // The backend keeps a copy of what was downloaded: it shows in the list.
      expect(await within(screen.getByTestId("backups")).findByText("Downloaded by you", {}, { timeout: 3000 })).toBeInTheDocument();
    } finally {
      saved.restore();
    }
  });

  it("every automatic backup has its own Download button; no paths, file manager or command lines anywhere", async () => {
    const { posts, container } = renderPage("/wallet", { scenario: "exits" });
    const box = await screen.findByTestId("backups", {}, { timeout: 3000 });
    const items = within(box).getAllByRole("listitem");
    expect(items.map((i) => i.querySelector("p.font-semibold")?.textContent)).toEqual([
      "Automatic backup (from version 1.0.0)",
      "Before a wallet change",
      "Before the upgrade from the old package",
    ]);
    expect(container).not.toHaveTextContent(/File manager|\/rocketpool\/|\bssh\b|docker|Download from DApp/i);
    // Simple mode shows no folder names either.
    expect(box).not.toHaveTextContent("legacy-20260919T081100Z");

    const saved = mockDownloads();
    try {
      await userEvent.click(within(items[2]).getByRole("button", { name: /^Download Before the upgrade from the old package/ }));
      const d = screen.getByRole("dialog", { name: "Download backup" });
      expect(d).toHaveTextContent("Before the upgrade from the old package");
      await userEvent.click(within(d).getByRole("button", { name: "Download" }));
      await screen.findByRole("dialog", { name: "Backup downloaded" });
      expect(downloadPosts(posts).map((p) => p.params)).toEqual([{ name: "legacy-20260919T081100Z" }]);
      expect(saved.names).toHaveLength(1);
    } finally {
      saved.restore();
    }
  });

  it("while the old phrase file is still on the box, every backup warns that it may hold the recovery phrase", async () => {
    renderPage("/wallet", { scenario: "mixed" });
    await userEvent.click(await screen.findByRole("button", { name: "Download backup" }, { timeout: 3000 }));
    expect(dialog()).toHaveTextContent(MAYBE_PHRASE_WARNING);
    expect(dialog()).toHaveTextContent(NEVER_SEND);
  });

  it("a backup that was tidied away since the list loaded: says so, and to reload", async () => {
    const api = createMockRocketpoolApi({ scenario: "exits" });
    api.downloadBackup = async () => {
      throw new RpApiError({ kind: "http", path: "/api/avado/backups/download", status: 404, detail: "There is no backup with that name." });
    };
    renderPage("/wallet", api);
    const box = await screen.findByTestId("backups", {}, { timeout: 3000 });
    await userEvent.click(within(box).getAllByRole("button", { name: /^Download / })[0]);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Download" }));
    expect(await within(dialog()).findByText("There is no backup with that name.")).toBeInTheDocument();
    expect(dialog()).toHaveTextContent("reload the page to see the current list");
  });

  it("Advanced mode also shows each backup's folder name", async () => {
    renderPage("/wallet", { scenario: "exits" }, { advanced: true });
    const box = await screen.findByTestId("backups", {}, { timeout: 3000 });
    expect(within(box).getByText("legacy-20260919T081100Z")).toBeInTheDocument();
  });

  it("a failed download says why in plain words, offers Try again, and saves nothing; Cancel sends nothing", async () => {
    const api = createMockRocketpoolApi({ scenario: "minipool" });
    const real = api.downloadBackup.bind(api);
    let fail = true;
    api.downloadBackup = async (name, opts) => {
      if (fail) {
        api.calls.push({ method: "POST", path: "/api/avado/backups/download", params: { name } });
        throw new RpApiError({ kind: "http", path: "/api/avado/backups/download", status: 429, detail: "Two backup downloads are already running. Please try again shortly." });
      }
      return real(name, opts);
    };
    const { posts } = renderPage("/wallet", api);
    const saved = mockDownloads();
    try {
      await userEvent.click(await screen.findByRole("button", { name: "Download backup" }, { timeout: 3000 }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(downloadPosts(posts)).toHaveLength(0);

      await userEvent.click(screen.getByRole("button", { name: "Download backup" }));
      await userEvent.click(within(dialog()).getByRole("button", { name: "Download" }));
      expect(await within(dialog()).findByText("The backup could not be downloaded")).toBeInTheDocument();
      expect(dialog()).toHaveTextContent("Two backup downloads are already running. Please try again shortly.");
      expect(dialog()).not.toHaveTextContent(/429|HTTP/);
      expect(within(dialog()).queryByTestId("tech-details")).toBeNull(); // Simple mode: no technical details
      expect(saved.names).toHaveLength(0);

      fail = false;
      await userEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("dialog", { name: "Backup downloaded" })).toBeInTheDocument();
      expect(saved.names).toHaveLength(1);
      expect(downloadPosts(posts)).toHaveLength(2);
    } finally {
      saved.restore();
    }
  });

  it("Simple mode has no way to show the secrets on screen", async () => {
    renderPage("/wallet", { scenario: "minipool" });
    await screen.findByTestId("node-wallet", {}, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: "Show the secrets…" })).toBeNull();
  });

  it("Advanced: shows the secrets only after EXPORT is typed; hidden until asked for and gone after closing", async () => {
    const { posts } = renderPage("/wallet", { scenario: "minipool" }, { advanced: true });
    await userEvent.click(await screen.findByRole("button", { name: "Show the secrets…" }, { timeout: 3000 }));
    const show = within(dialog()).getByRole("button", { name: "Show the secrets" });
    expect(show).toBeDisabled();
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "export");
    expect(show).toBeDisabled();
    await userEvent.clear(within(dialog()).getByLabelText(/to confirm/));
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "EXPORT");
    await userEvent.click(show);
    expect(await screen.findByRole("dialog", { name: "Your wallet's secrets" })).toBeInTheDocument();
    // The same rule as the download: never send it, support never asks; no "not even with support" contradiction.
    expect(dialog()).toHaveTextContent("Never send this file or these values to anyone — AVADO support will never ask for them.");
    expect(dialog()).toHaveTextContent(RESTORE_TEXT);
    expect(posts()).toEqual([{ method: "POST", path: "/api/sn/wallet/export", params: { typedConfirmation: "EXPORT" } }]);
    expect(screen.queryByText("demo-password-not-real", { exact: false })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Show the values on screen" }));
    expect(within(screen.getByTestId("export-values")).getByText(/demo-password-not-real/)).toBeInTheDocument();

    // The download is built on the click from memory: a blob, never a link to the backend.
    const saved = mockDownloads();
    try {
      await userEvent.click(within(dialog()).getByRole("button", { name: "Download the backup file" }));
      expect(saved.names).toEqual([`rocketpool-wallet-${DEMO.nodeAddress.toLowerCase()}.json`]);
      await waitFor(() => expect(saved.revoked).toEqual(["blob:demo-1"]), { timeout: REVOKE_AFTER_MS + 2000 });
      const text = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsText(saved.blobs[0]);
      });
      expect(JSON.parse(text)).toMatchObject({ nodeAddress: DEMO.nodeAddress, password: "demo-password-not-real", walletFile: '{"demo":"not a real wallet"}' });
    } finally {
      saved.restore();
    }

    await userEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/demo-password-not-real/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show the secrets…" }));
    expect(within(dialog()).getByRole("button", { name: "Show the secrets" })).toBeDisabled();
    expect(posts()).toHaveLength(1);
  });

  it("Advanced: says why showing the secrets failed, with the details folded away", async () => {
    renderPage("/wallet", { scenario: "minipool", failures: { "wallet/export": new DemoSnError(500, "could not read the wallet") } }, { advanced: true });
    await userEvent.click(await screen.findByRole("button", { name: "Show the secrets…" }, { timeout: 3000 }));
    await userEvent.type(within(dialog()).getByLabelText(/to confirm/), "EXPORT");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Show the secrets" }));
    expect(await within(dialog()).findByText("could not read the wallet.")).toBeInTheDocument();
    expect(within(dialog()).getByTestId("tech-details")).toHaveTextContent("/api/sn/wallet/export · http · HTTP 500 · could not read the wallet");
  });

  it("the old recovery-phrase file: moved only after ARCHIVE is typed, then listed with its own warning", async () => {
    const { posts } = renderPage("/wallet", { scenario: "mixed" });
    const box = await screen.findByTestId("legacy-mnemonic", {}, { timeout: 3000 });
    const move = within(box).getByRole("button", { name: "Move the file into the backups" });
    expect(move).toBeDisabled();
    await userEvent.type(within(box).getByLabelText(/to confirm/), "ARCHIVE");
    await userEvent.click(move);
    expect(await within(box).findByText("The file was moved into the backups")).toBeInTheDocument();
    expect(box).not.toHaveTextContent("/rocketpool/");
    expect(posts()).toEqual([{ method: "POST", path: "/api/avado/legacy-mnemonic/archive", params: { confirm: "ARCHIVE" } }]);
    // The shell's banner goes away with the next status, and the moved file is listed with its own warning.
    await waitFor(() => expect(screen.queryByText("Your recovery phrase is saved in an unprotected file")).toBeNull(), { timeout: 3000 });
    const item = within(screen.getByTestId("backups")).getByText("Old recovery phrase file").closest("li")!;
    await userEvent.click(within(item).getByRole("button", { name: /^Download Old recovery phrase file/ }));
    expect(dialog()).toHaveTextContent("This file holds your node wallet's recovery phrase (24 words) as plain text.");
  });

  it("without a wallet: set up first, no backup button, and no backups yet", async () => {
    renderPage("/wallet", { scenario: "fresh" });
    expect(await screen.findByText("Your node isn't set up yet", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("backup-now")).toBeNull();
    expect(within(screen.getByTestId("backups")).getByText(/No backups yet\. One is made by itself before the next update, and one each time you press Download backup\./)).toBeInTheDocument();
  });
});
