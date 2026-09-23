/**
 * Standard keymanager API through the package backend's
 * `${apiUrl}/keymanager` proxy, which adds the bearer token server side (the
 * browser never sees it). Browser paths are the same for every client:
 *  - Nimbus (deno): → localhost:5052
 *  - Teku (monitor): → https://teku[-net].my.ava.do:5052
 *  - Prysm (monitor): → the eth2validator package's monitor, which adds the
 *    token and forwards to the Prysm validator client (two hops).
 * Prysm reports statuses in upper case; they are normalised to the standard
 * lower case here.
 */
import type { ClientConfig } from "../config/clientConfig";
import { ApiError } from "./errors";
import { createHttp, getData, unwrapData, type AdapterDeps } from "./http";
import type {
  DeleteKeystoresResponse,
  DeleteStatus,
  ImportResult,
  ImportStatus,
  Keystore,
  KeymanagerApi,
  SignedVoluntaryExit,
} from "./types";

const lower = <T extends string>(s: unknown) => (typeof s === "string" ? s.toLowerCase() : s) as T;

function normaliseResults<S extends string>(
  list: unknown,
  path: string,
): Array<{ status: S; message?: string }> {
  if (!Array.isArray(list)) throw new ApiError({ kind: "invalid", service: "keymanager", path, detail: "data is not an array" });
  return list.map((r) => {
    const { status, ...rest } = (r ?? {}) as { status?: unknown; message?: string };
    return { ...rest, status: lower<S>(status) };
  });
}

export function createKeymanagerApi(config: Pick<ClientConfig, "apiUrl">, deps: AdapterDeps = {}): KeymanagerApi {
  const http = createHttp({
    baseUrl: `${config.apiUrl.replace(/\/+$/, "")}/keymanager`,
    service: "keymanager",
    fetch: deps.fetch,
    proxied: true,
    // Importing scrypt keystores takes a few seconds per key.
    timeoutMs: 120_000,
  });
  const feePath = (pk: string) => `/eth/v1/validator/${encodeURIComponent(pk)}/feerecipient`;

  return {
    async listKeystores() {
      const path = "/eth/v1/keystores";
      const keys = await getData<Keystore[]>(http, "keymanager", path);
      if (!Array.isArray(keys)) throw new ApiError({ kind: "invalid", service: "keymanager", path, detail: "data is not an array" });
      return keys;
    },

    async importKeystores(req) {
      const path = "/eth/v1/keystores";
      const body: Record<string, unknown> = { keystores: req.keystores, passwords: req.passwords };
      if (req.slashing_protection !== undefined) body.slashing_protection = req.slashing_protection;
      const { status, data } = await http.request(path, { method: "POST", body });
      return normaliseResults<ImportStatus>(unwrapData(data, "keymanager", path, status), path) as ImportResult[];
    },

    async deleteKeystores(pubkeys): Promise<DeleteKeystoresResponse> {
      const path = "/eth/v1/keystores";
      const { status, data } = await http.request(path, { method: "DELETE", body: { pubkeys } });
      const results = normaliseResults<DeleteStatus>(unwrapData(data, "keymanager", path, status), path);
      const sp = (data as { slashing_protection?: unknown }).slashing_protection;
      if (sp === undefined || sp === null) {
        throw new ApiError({ kind: "invalid", service: "keymanager", path, status, detail: "no slashing_protection in the response" });
      }
      return { data: results, slashing_protection: typeof sp === "string" ? sp : JSON.stringify(sp) };
    },

    async getFeeRecipient(pubkey) {
      const path = feePath(pubkey);
      const { status, data } = await http.request(path, { accept: (s) => s === 404 });
      if (status === 404) return null;
      const d = unwrapData<{ ethaddress?: unknown }>(data, "keymanager", path, status);
      return typeof d?.ethaddress === "string" ? d.ethaddress : null;
    },

    async setFeeRecipient(pubkey, ethaddress) {
      await http.request(feePath(pubkey), { method: "POST", body: { ethaddress } });
    },

    async deleteFeeRecipient(pubkey) {
      await http.request(feePath(pubkey), { method: "DELETE" });
    },

    async signVoluntaryExit(pubkey, epoch) {
      // The `?epoch=` query parameter cannot pass the package proxies (they
      // forward the path only), so the client always signs for the current epoch.
      if (epoch !== undefined) throw new Error("signVoluntaryExit: an explicit epoch cannot pass the package proxy");
      const path = `/eth/v1/validator/${encodeURIComponent(pubkey)}/voluntary_exit`;
      const { status, data } = await http.request(path, { method: "POST" });
      return unwrapData<SignedVoluntaryExit>(data, "keymanager", path, status);
    },
  };
}
