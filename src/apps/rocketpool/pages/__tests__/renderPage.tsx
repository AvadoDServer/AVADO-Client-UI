import { render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ROUTER_FUTURE } from "../../../../routing/routerFuture";
import { MODE_STORAGE_KEY } from "../../../../settings/ModeProvider";
import { createMockRocketpoolApi, type MockRocketpoolApi, type RocketpoolMockOptions } from "../../api/mock";
import { AppRoutes, Providers } from "../../App";

/** The whole app (shell, banners, pending store) on a demo node, at `path`. */
export function renderPage(path: string, mock: RocketpoolMockOptions | MockRocketpoolApi = {}, { advanced = false } = {}) {
  if (advanced) localStorage.setItem(MODE_STORAGE_KEY, "advanced");
  const api = "calls" in mock ? mock : createMockRocketpoolApi(mock);
  const utils = render(
    <Providers api={api}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
  const posts = () => api.calls.filter((c) => c.method === "POST");
  return { api, posts, ...utils };
}

/** Press a dialog's confirm button once it is armed (it is disabled for a moment after the summary shows). */
export async function confirmIn(dialog: HTMLElement, name: string) {
  const button = await within(dialog).findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled(), { timeout: 3000 });
  await userEvent.click(button);
}

/**
 * Catches the files the page hands to the browser's downloads: object URLs
 * and the temporary link's click. Nothing is saved; `restore()` puts the
 * browser functions back.
 */
export function mockDownloads() {
  const names: string[] = [];
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
  let n = 0;
  Object.assign(URL, {
    createObjectURL: (b: Blob) => {
      blobs.push(b);
      n += 1;
      return `blob:demo-${n}`;
    },
    revokeObjectURL: (u: string) => {
      revoked.push(u);
    },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return {
    names,
    blobs,
    revoked,
    restore() {
      click.mockRestore();
      // jsdom has no object URLs: keep a no-op revoke for a page timer that fires after the test.
      Object.assign(URL, { createObjectURL: original.createObjectURL, revokeObjectURL: original.revokeObjectURL ?? (() => undefined) });
    },
  };
}
