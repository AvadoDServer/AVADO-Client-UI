/**
 * The wallet calls of the setup wizard. They send secrets (a recovery phrase,
 * the wallet password) straight to the backend and keep nothing: no storage,
 * no logs, and error texts are cleaned of the phrase before they are shown.
 */
import { isRpApiError, plainError } from "../../api/errors";
import type { InitWalletResponse, RecoverWalletResponse } from "../../api/models";
import type { RocketpoolApi } from "../../api/types";
import { normalizeMnemonic, randomWalletPassword } from "../../lib/mnemonic";

/**
 * Sets a random wallet password unless one is set already (the backend
 * answers 409 then, which is fine: the password file exists).
 */
export async function ensureWalletPassword(api: RocketpoolApi, passwordSet: boolean): Promise<void> {
  if (passwordSet) return;
  try {
    await api.snPost("wallet/set-password", { password: randomWalletPassword() });
  } catch (e) {
    if (isRpApiError(e) && e.kind === "http" && e.status === 409) return;
    throw e;
  }
}

/** A new recovery phrase from Smartnode. It is not saved until `saveWallet`. */
export const newWallet = (api: RocketpoolApi) => api.snPost<InitWalletResponse>("wallet/init");

/**
 * Saves the wallet from its recovery phrase. `withValidatorKeys` also
 * regenerates the validator keys of an existing node (restore); a new wallet
 * has none (`skipValidatorKeyRecovery`). With `nodeAddress`, Smartnode
 * searches the derivation paths for that address.
 */
export function saveWallet(
  api: RocketpoolApi,
  phrase: string,
  { withValidatorKeys, nodeAddress }: { withValidatorKeys: boolean; nodeAddress?: string },
): Promise<RecoverWalletResponse> {
  const mnemonic = normalizeMnemonic(phrase);
  const skipValidatorKeyRecovery = withValidatorKeys ? "false" : "true";
  return nodeAddress
    ? api.snPost<RecoverWalletResponse>("wallet/search-and-recover", { mnemonic, address: nodeAddress, skipValidatorKeyRecovery })
    : api.snPost<RecoverWalletResponse>("wallet/recover", { mnemonic, skipValidatorKeyRecovery });
}

/**
 * The error in plain words, without the recovery phrase: Smartnode quotes the
 * whole phrase in "Invalid mnemonic '…'".
 */
export function walletError(e: unknown, phrase?: string): string {
  let text = plainError(e).replace(/invalid mnemonic\s*'[^']*'/gi, "This is not a valid recovery phrase: check every word and their order");
  const words = phrase ? normalizeMnemonic(phrase) : "";
  if (words) text = text.split(words).join("[your recovery phrase]");
  return text;
}
