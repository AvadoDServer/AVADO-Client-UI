/**
 * Amounts for people: wei in, "1.25 ETH" out. Never shows raw wei.
 *
 * Smartnode sends big integers (wei, RPL base units) as JSON numbers; the
 * package backend turns any above 2^53 - 1 into strings with the exact
 * digits. So a big integer arrives as a string or a safe-integer number.
 * All maths here is on bigint, so nothing is lost to floating point.
 */

/** A big integer as it arrives from the backend. */
export type BigNumberish = string | number | bigint;

export const WEI_PER_ETH = 10n ** 18n;
export const WEI_PER_GWEI = 10n ** 9n;

/** The exact integer, or null for anything that isn't one (missing, "", 1.5, "abc", unsafe numbers). */
export function toBigInt(value: BigNumberish | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? BigInt(value) : null;
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) return null;
  return BigInt(text);
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export interface FormatOptions {
  /** Most digits after the point (default 4). Trailing zeros are dropped. */
  maxDecimals?: number;
  /** Base-unit decimals of the token (default 18). */
  decimals?: number;
  /** Group thousands with commas (default true). */
  grouping?: boolean;
}

/**
 * "1,234.5678": rounded half up to `maxDecimals`, trailing zeros dropped.
 * A non-zero amount too small to show reads "< 0.0001" rather than "0".
 */
export function formatUnits(value: BigNumberish, opts: FormatOptions = {}): string {
  const { maxDecimals = 4, decimals = 18, grouping = true } = opts;
  const raw = toBigInt(value);
  if (raw === null) return "—";
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const places = Math.max(0, Math.min(maxDecimals, decimals));
  const step = 10n ** BigInt(decimals - places);
  const rounded = (abs + step / 2n) / step; // in units of 10^-places
  if (rounded === 0n && abs !== 0n) {
    const smallest = places === 0 ? "1" : `0.${"0".repeat(places - 1)}1`;
    return `${negative ? "> -" : "< "}${smallest}`;
  }
  const scale = 10n ** BigInt(places);
  const whole = rounded / scale;
  let frac = places > 0 ? (rounded % scale).toString().padStart(places, "0") : "";
  frac = frac.replace(/0+$/, "");
  const wholeText = grouping ? group(whole.toString()) : whole.toString();
  const sign = negative && rounded !== 0n ? "-" : "";
  return `${sign}${wholeText}${frac ? `.${frac}` : ""}`;
}

/** "1.25 ETH" from wei. */
export const formatEth = (wei: BigNumberish | null | undefined, maxDecimals = 4): string =>
  wei === null || wei === undefined || toBigInt(wei) === null ? "—" : `${formatUnits(wei, { maxDecimals })} ETH`;

/** "1,200.5 RPL" from RPL base units (18 decimals). */
export const formatRpl = (amount: BigNumberish | null | undefined, maxDecimals = 2): string =>
  amount === null || amount === undefined || toBigInt(amount) === null ? "—" : `${formatUnits(amount, { maxDecimals })} RPL`;

/** A gas cost: small amounts, so more digits (0.000315 ETH). */
export const formatGasCost = (wei: BigNumberish): string => formatEth(wei, 6);

/**
 * Exact gwei as a decimal string ("12.5", "0.000000001"), for the `maxFee` /
 * `maxPrioFee` fields Smartnode reads as gwei.
 */
export function weiToGweiString(wei: bigint): string {
  const whole = wei / WEI_PER_GWEI;
  const frac = (wei % WEI_PER_GWEI).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** "12.5 gwei", rounded to 2 decimals (a small non-zero price keeps 3 significant digits). */
export function formatGwei(wei: BigNumberish): string {
  const v = toBigInt(wei);
  if (v === null) return "—";
  if (v > 0n && v < WEI_PER_GWEI / 100n) return `${formatUnits(v, { decimals: 9, maxDecimals: 6 })} gwei`;
  return `${formatUnits(v, { decimals: 9, maxDecimals: 2 })} gwei`;
}

/**
 * What a person types ("1", "0.5", ".25") → base units, or null when it
 * isn't a plain non-negative amount or has more decimals than the token.
 * Commas are refused, not guessed: "1,5" could mean 1.5 or 15.
 */
export function parseUnits(input: string, decimals = 18): bigint | null {
  const text = input.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const whole = m[1] || "0";
  const frac = m[2] ?? "";
  if (frac.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

const ZERO_ADDRESS = /^0x0{40}$/i;

/** Smartnode reports "no address" as the zero address. */
export const isZeroAddress = (address: string | null | undefined): boolean => !address || ZERO_ADDRESS.test(address);

/** "0x1234…abcd". */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Same address, ignoring checksum case. */
export const sameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
