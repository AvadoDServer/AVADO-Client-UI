import { describe, expect, it } from "vitest";
import { checksumState, toChecksumAddress } from "../checksum";

// EIP-55 test vectors
const VALID = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
];

describe("checksum", () => {
  it("produces the EIP-55 form from any case", () => {
    for (const a of VALID) {
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
      expect(toChecksumAddress(`0x${a.slice(2).toUpperCase()}`)).toBe(a);
    }
  });

  it("classifies addresses", () => {
    expect(checksumState(VALID[0])).toBe("valid");
    expect(checksumState(VALID[0].toLowerCase())).toBe("unchecked");
    expect(checksumState(`0x${VALID[0].slice(2).toUpperCase()}`)).toBe("unchecked");
    // one letter's case flipped: a typo the checksum catches
    expect(checksumState("0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe("invalid");
    expect(checksumState("0x123")).toBe("not-address");
    expect(checksumState("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe("not-address");
  });
});
