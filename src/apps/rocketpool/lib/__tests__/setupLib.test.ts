import { qrMatrix } from "../../components/QrCode";
import { SCENARIOS, DEMO, ZERO_ADDRESS } from "../../api/fixtures";
import type { NodeStatus } from "../../api/models";
import { firstOpenStep, nextStepId, stepStatuses, blockingStep } from "../../pages/setup/steps";
import { MAX_VALIDATOR_BOND_WEI, MIN_VALIDATOR_BOND_WEI, newValidatorBonds, sumWei } from "../bond";
import {
  mnemonicProblem,
  mnemonicWords,
  normalizeMnemonic,
  ordinal,
  pickConfirmPositions,
  randomWalletPassword,
  secureRandomInt,
  wrongPositions,
} from "../mnemonic";
import { defaultTimezone, isTimezone, timezoneOptions } from "../timezones";

const ETH = 10n ** 18n;

describe("recovery phrase helpers", () => {
  it("reads a typed phrase: any spacing and case, and says plainly what is wrong", () => {
    expect(mnemonicWords("  Abandon   ability\nable ")).toEqual(["abandon", "ability", "able"]);
    expect(normalizeMnemonic(" A  b ")).toBe("a b");
    expect(mnemonicProblem("")).toBe("Enter your recovery phrase.");
    expect(mnemonicProblem("one two three")).toBe("A recovery phrase has 12, 15, 18, 21 or 24 words; this one has 3.");
    expect(mnemonicProblem(`${"word ".repeat(11)}w0rd`)).toMatch(/only words made of the letters a to z/);
    expect(mnemonicProblem("word ".repeat(12))).toBeNull();
    expect(mnemonicProblem("word ".repeat(24))).toBeNull();
  });

  it("asks back 3 different positions, sorted, from the crypto source", () => {
    const seq = [5, 5, 20, 1];
    const rand = vi.fn(() => seq.shift()!);
    expect(pickConfirmPositions(24, 3, rand)).toEqual([1, 5, 20]);
    expect(rand).toHaveBeenCalledWith(24);
    for (let i = 0; i < 50; i++) {
      const p = pickConfirmPositions(24);
      expect(new Set(p).size).toBe(3);
      expect(p.every((x) => x >= 0 && x < 24)).toBe(true);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
    }
    const spy = vi.spyOn(crypto, "getRandomValues");
    secureRandomInt(24);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(() => secureRandomInt(0)).toThrow();
  });

  it("checks the typed words, ignoring case and spaces", () => {
    const words = ["alpha", "bravo", "charlie", "delta"];
    expect(wrongPositions(words, [0, 2, 3], [" Alpha", "charlie", "delta "])).toEqual([]);
    expect(wrongPositions(words, [0, 2, 3], ["alpha", "bravo", ""])).toEqual([2, 3]);
  });

  it("makes a strong random wallet password that changes every time", () => {
    const a = randomWalletPassword();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(randomWalletPassword()).not.toBe(a);
  });

  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "24th",
    ]);
  });
});

describe("megapool bond (Smartnode CLI rule)", () => {
  it("a new node: each validator adds the step in the requirement", () => {
    expect(newValidatorBonds([4n * ETH, 8n * ETH], 0n)).toEqual([4n * ETH, 4n * ETH]);
  });

  it("counts what is already bonded or queued once, then the previous requirement", () => {
    // Bonded 8 (2 validators), requirements for validators 3 and 4: 12 and 14 ETH.
    expect(newValidatorBonds([12n * ETH, 14n * ETH], 8n * ETH)).toEqual([4n * ETH, 2n * ETH]);
  });

  it("never asks less than 1 ETH or more than 32 ETH per validator", () => {
    expect(newValidatorBonds([4n * ETH], 10n * ETH)).toEqual([MIN_VALIDATOR_BOND_WEI]);
    expect(newValidatorBonds([100n * ETH], 0n)).toEqual([MAX_VALIDATOR_BOND_WEI]);
    expect(sumWei([1n, 2n, 3n])).toBe(6n);
  });

  // Moved from the Validators model tests when the two deposit screens were merged.
  it("first: requirement minus what is bonded and queued; then the step between requirements", () => {
    // Bonded 8 + queued 4; requirements for 4, 5, 6 validators: 16, 20, 24 ETH.
    const r = newValidatorBonds([16n * ETH, 20n * ETH, 24n * ETH], 8n * ETH + 4n * ETH);
    expect(r).toEqual([4n * ETH, 4n * ETH, 4n * ETH]);
    expect(sumWei(r)).toBe(12n * ETH);
  });

  it("each validator's bond stays between 1 and 32 ETH, and wei stay exact", () => {
    expect(newValidatorBonds([8n * ETH], 20n * ETH)).toEqual([ETH]);
    expect(newValidatorBonds([40n * ETH], 0n)).toEqual([32n * ETH]);
    expect(sumWei(newValidatorBonds([], 0n))).toBe(0n);
    expect(sumWei(newValidatorBonds([4n * ETH], 1n))).toBe(4n * ETH - 1n);
  });
});

describe("time zones", () => {
  it("offers Region/City names and a sane default", () => {
    const list = timezoneOptions();
    expect(list).toContain("Etc/UTC");
    expect(list.every(isTimezone)).toBe(true);
    expect(isTimezone("Europe/Ljubljana")).toBe(true);
    expect(isTimezone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isTimezone("UTC")).toBe(false);
    expect(isTimezone("Europe/Ljubljana; rm")).toBe(false);
    expect(isTimezone(defaultTimezone())).toBe(true);
  });
});

describe("QR code", () => {
  it("encodes an address with the three finder patterns", () => {
    const m = qrMatrix(DEMO.nodeAddress);
    const n = m.length;
    expect(n).toBeGreaterThanOrEqual(25);
    // The 7×7 finder squares: dark outer ring, light ring, dark 3×3 core.
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        expect(m[r0][c0 + i]).toBe(true);
        expect(m[r0 + 6][c0 + i]).toBe(true);
      }
      expect(m[r0 + 1][c0 + 1]).toBe(false);
      expect(m[r0 + 3][c0 + 3]).toBe(true);
    }
  });
});

describe("setup steps", () => {
  const node = (scenario: keyof typeof SCENARIOS, patch: Partial<NodeStatus> = {}) =>
    ({ ...(SCENARIOS[scenario].reads["node/status"] as NodeStatus), ...patch }) as NodeStatus;

  it("no wallet: only the wallet step is open", () => {
    const s = stepStatuses({ walletReady: false });
    expect(s).toEqual({ wallet: "open", fund: "locked", register: "locked", withdrawal: "locked", smoothing: "locked", validators: "locked" });
    expect(firstOpenStep(s)).toBe("wallet");
    expect(blockingStep("register", s)).toBe("wallet");
  });

  it("a wallet the node can't read yet: unknown, starting at funding", () => {
    const s = stepStatuses({ walletReady: true });
    expect(s.wallet).toBe("done");
    expect(s.register).toBe("unknown");
    expect(firstOpenStep(s)).toBe("fund");
  });

  it("funded but not registered: register next; the rest waits for it", () => {
    const s = stepStatuses({ walletReady: true, node: node("unregistered") });
    expect(s).toMatchObject({ fund: "done", register: "open", withdrawal: "locked", smoothing: "locked", validators: "locked" });
    expect(firstOpenStep(s)).toBe("register");
    expect(blockingStep("validators", s)).toBe("register");
    expect(firstOpenStep(stepStatuses({ walletReady: true, node: node("unregistered", { accountBalances: { eth: 0, rpl: 0, reth: 0 } }) }))).toBe("fund");
  });

  it("registered, withdrawal address waiting for confirmation, no validators: validators next", () => {
    const s = stepStatuses({ walletReady: true, node: node("new-node") });
    expect(s).toMatchObject({ register: "done", withdrawal: "pending", smoothing: "optional", validators: "open" });
    expect(firstOpenStep(s)).toBe("validators");
  });

  it("registered with the node wallet as withdrawal address: that comes first", () => {
    const s = stepStatuses({ walletReady: true, node: node("new-node", { pendingPrimaryWithdrawalAddress: ZERO_ADDRESS }) });
    expect(s.withdrawal).toBe("open");
    expect(firstOpenStep(s)).toBe("withdrawal");
  });

  it("an existing node is done; the smoothing pool stays optional", () => {
    const s = stepStatuses({ walletReady: true, node: node("minipool") });
    expect(Object.values(s).every((v) => v === "done")).toBe(true);
    expect(firstOpenStep(s)).toBe("validators");
    const mixed = stepStatuses({ walletReady: true, node: node("mixed") });
    expect(mixed).toMatchObject({ withdrawal: "open", smoothing: "optional", validators: "done" });
    expect(firstOpenStep(mixed)).toBe("withdrawal");
    expect(nextStepId("wallet")).toBe("fund");
    expect(nextStepId("validators")).toBeNull();
  });
});

describe("EIP-55 checksum", () => {
  it("matches the EIP's test vectors and tells typos from unchecked addresses", async () => {
    const { checksumState, toChecksumAddress } = await import("../checksum");
    const vectors = [
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ];
    for (const v of vectors) {
      expect(toChecksumAddress(v.toLowerCase())).toBe(v);
      expect(checksumState(v)).toBe("valid");
    }
    // One letter's case flipped: a wrong checksum.
    expect(checksumState("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")).toBe("invalid");
    expect(checksumState(vectors[0].toLowerCase())).toBe("unchecked");
    expect(checksumState(`0x${vectors[0].slice(2).toUpperCase()}`)).toBe("unchecked");
    expect(checksumState("0x123")).toBe("not-address");
  });
});
