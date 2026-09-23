/** Block explorer links (mainnet only: the package runs on mainnet). */
export const EXPLORER_URL = "https://etherscan.io";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const isTxHash = (hash: unknown): hash is string => typeof hash === "string" && TX_HASH.test(hash);
export const isAddress = (address: unknown): address is string => typeof address === "string" && ADDRESS.test(address);

/** The explorer page of a transaction, or null for anything that isn't a tx hash. */
export const txUrl = (hash: string): string | null => (isTxHash(hash) ? `${EXPLORER_URL}/tx/${hash}` : null);

/** The explorer page of an address, or null for anything that isn't one. */
export const addressUrl = (address: string): string | null => (isAddress(address) ? `${EXPLORER_URL}/address/${address}` : null);

/** A validator on beaconcha.in by its 0x-less or 0x pubkey. */
export const validatorUrl = (pubkey: string): string | null => {
  const hex = pubkey.startsWith("0x") ? pubkey.slice(2) : pubkey;
  return /^[0-9a-fA-F]{96}$/.test(hex) ? `https://beaconcha.in/validator/0x${hex}` : null;
};
