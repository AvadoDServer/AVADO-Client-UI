import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ApiProvider } from "../../../api/ApiProvider";
import type { Api } from "../../../api/types";
import { ClientConfigProvider } from "../../../config/ClientConfigProvider";
import { normalizeClientConfig, type ClientConfig } from "../../../config/clientConfig";

/** Render a page with a fixed client config and the given adapters (inside a router, for its links). */
export function renderWithApi(ui: ReactElement, api: Api, config: Partial<ClientConfig> = {}) {
  const cfg = normalizeClientConfig({ client: "nimbus", network: "mainnet", ...config });
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ClientConfigProvider config={cfg}>
        <ApiProvider api={api}>{ui}</ApiProvider>
      </ClientConfigProvider>
    </MemoryRouter>,
  );
}

/** A minimal EIP-2335 keystore JSON for the mocks (only `pubkey` matters there). */
export function fakeKeystore(pubkey: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    crypto: { kdf: { function: "scrypt" }, checksum: {}, cipher: {} },
    pubkey: pubkey.replace(/^0x/, ""),
    path: "m/12381/3600/0/0/0",
    uuid: "00000000-0000-4000-8000-000000000000",
    version: 4,
    ...extra,
  });
}
