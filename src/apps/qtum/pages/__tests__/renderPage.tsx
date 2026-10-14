import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ROUTER_FUTURE } from "../../../../routing/routerFuture";
import { MODE_STORAGE_KEY } from "../../../../settings/ModeProvider";
import { createMockQtumApi, type MockQtumApi, type QtumMockOptions } from "../../api/mock";
import { AppRoutes, Providers } from "../../App";

/** The whole app (shell, strip, banners) on a demo node, at `path`. */
export function renderPage(path: string, mock: QtumMockOptions | MockQtumApi = {}, { advanced = false } = {}) {
  if (advanced) localStorage.setItem(MODE_STORAGE_KEY, "advanced");
  const api = "calls" in mock ? mock : createMockQtumApi(mock);
  const utils = render(
    <Providers api={api}>
      <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
  const posts = () => api.calls.filter((c) => c.kind === "POST");
  const rpcs = (method?: string) => api.calls.filter((c) => c.kind === "rpc" && (!method || c.path === method));
  return { api, posts, rpcs, ...utils };
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
