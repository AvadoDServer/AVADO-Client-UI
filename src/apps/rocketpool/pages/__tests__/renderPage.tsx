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
