/**
 * EIP-55 address checksums: the capital letters of a mixed-case address
 * encode a keccak-256 hash of it, so a typo or a swapped character shows.
 */
import { keccak_256 } from "@noble/hashes/sha3";

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The EIP-55 form of a hex address (any case in). */
export function toChecksumAddress(address: string): string {
  if (!HEX_ADDRESS.test(address)) throw new TypeError("not an address");
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/**
 * - "valid": mixed case with a correct checksum
 * - "unchecked": all lower or all upper case: no checksum to check
 * - "invalid": mixed case with a wrong checksum (a typo or a changed character)
 * - "not-address": not 0x + 40 hex characters
 */
export type ChecksumState = "valid" | "unchecked" | "invalid" | "not-address";

export function checksumState(address: string): ChecksumState {
  if (!HEX_ADDRESS.test(address)) return "not-address";
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return "unchecked";
  return toChecksumAddress(address) === address ? "valid" : "invalid";
}

/** What to tell someone whose address fails its checksum. */
export const BAD_CHECKSUM =
  "This address has a typo: its capital letters don't match. Copy it again from your wallet.";
