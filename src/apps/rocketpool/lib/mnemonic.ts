/**
 * Recovery-phrase helpers for the wallet setup. A phrase only ever lives in
 * the setup step's React state: never in storage, logs or the URL.
 */

/** The word counts BIP-39 allows (Smartnode checks the words themselves). */
export const MNEMONIC_LENGTHS: readonly number[] = [12, 15, 18, 21, 24];

/** How many words the owner types back before a new wallet is saved. */
export const CONFIRM_WORD_COUNT = 3;

/** The words of a phrase as typed: trimmed, lower case, any whitespace between. */
export function mnemonicWords(phrase: string): string[] {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** The phrase in the form Smartnode expects: single spaces, lower case. */
export const normalizeMnemonic = (phrase: string): string => mnemonicWords(phrase).join(" ");

/** Why a typed phrase can't be a recovery phrase, in plain words; null when it may be one. */
export function mnemonicProblem(phrase: string): string | null {
  const words = mnemonicWords(phrase);
  if (words.length === 0) return "Enter your recovery phrase.";
  if (words.some((w) => !/^[a-z]+$/.test(w))) return "A recovery phrase has only words made of the letters a to z, separated by spaces.";
  if (!MNEMONIC_LENGTHS.includes(words.length)) {
    return `A recovery phrase has 12, 15, 18, 21 or 24 words; this one has ${words.length}.`;
  }
  return null;
}

/** A uniform random integer in [0, max) from the browser's cryptographic random source. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError("max out of range");
  const limit = Math.floor(2 ** 32 / max) * max; // reject the biased tail
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** `count` different word positions (0-based, ascending) to ask back. */
export function pickConfirmPositions(wordCount: number, count = CONFIRM_WORD_COUNT, rand: (max: number) => number = secureRandomInt): number[] {
  if (count > wordCount) throw new RangeError("more positions than words");
  const picked = new Set<number>();
  while (picked.size < count) picked.add(rand(wordCount));
  return [...picked].sort((a, b) => a - b);
}

/** The positions whose typed word doesn't match the phrase (empty: all correct). */
export function wrongPositions(words: readonly string[], positions: readonly number[], answers: readonly string[]): number[] {
  return positions.filter((p, i) => (answers[i] ?? "").trim().toLowerCase() !== words[p]);
}

/**
 * A strong random password for the wallet file (64 hex characters). The owner
 * never needs it: the recovery phrase restores the wallet, and the password
 * stays on the AVADO in the package's password file.
 */
export function randomWalletPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "1st", "2nd", "3rd", "4th", … "21st", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
