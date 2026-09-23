/**
 * Reading and sorting the files an owner drops on the Add validators page.
 * Pure helpers, tested on their own.
 */
import type { ImportResult } from "../../api/types";

export type DroppedKind = "keystore" | "slashing" | "deposit" | "invalid";

export interface ClassifiedFile {
  kind: DroppedKind;
  /** 0x-prefixed lowercase pubkey, for keystores. */
  pubkey?: string;
  /** Why the file can't be used, in plain words. */
  reason?: string;
}

/** Read a File as text (FileReader, so it also works where Blob.text() doesn't). */
export function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error(`Couldn't read ${file.name}`));
    r.readAsText(file);
  });
}

/**
 * EIP-2335 keystore, EIP-3076 slashing-protection interchange, a
 * deposit_data file (a common mix-up) or something else.
 */
export function classifyFile(text: string): ClassifiedFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "invalid", reason: "This isn't a keystore file (it isn't JSON)." };
  }
  if (Array.isArray(json)) {
    if (json.some((d) => d && typeof d === "object" && "deposit_data_root" in d)) {
      return {
        kind: "deposit",
        reason: "This is a deposit data file. It isn't needed here: add the keystore-m_… files instead.",
      };
    }
    return { kind: "invalid", reason: "This isn't a keystore file." };
  }
  if (!json || typeof json !== "object") return { kind: "invalid", reason: "This isn't a keystore file." };
  const o = json as Record<string, unknown>;
  const meta = o.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta === "object" && "interchange_format_version" in meta && Array.isArray(o.data)) {
    return { kind: "slashing" };
  }
  if (o.crypto && typeof o.crypto === "object" && typeof o.pubkey === "string") {
    const hex = o.pubkey.replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{96}$/.test(hex)) return { kind: "invalid", reason: "This keystore has no valid public key." };
    return { kind: "keystore", pubkey: `0x${hex}` };
  }
  return { kind: "invalid", reason: "This isn't a keystore file." };
}

export interface ImportTally {
  imported: number;
  duplicate: number;
  error: number;
}

export function tally(results: Array<ImportResult | undefined>): ImportTally {
  const t: ImportTally = { imported: 0, duplicate: 0, error: 0 };
  for (const r of results) if (r) t[r.status === "imported" || r.status === "duplicate" ? r.status : "error"] += 1;
  return t;
}

/** "2 imported, 1 already on this node, 1 failed" */
export function tallyText(t: ImportTally): string {
  const parts = [];
  if (t.imported) parts.push(`${t.imported} imported`);
  if (t.duplicate) parts.push(`${t.duplicate} already on this node`);
  if (t.error) parts.push(`${t.error} failed`);
  return parts.join(", ") || "Nothing imported";
}

/** Plain words for a keymanager import error. */
export function importErrorText(message: string | undefined): string {
  const m = (message ?? "").trim();
  if (/password|decrypt|checksum/i.test(m)) return "Wrong password";
  return m ? `Not imported: ${m}` : "Not imported";
}
