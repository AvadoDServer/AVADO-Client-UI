import { txUrl, addressUrl, isTxHash, validatorUrl } from "../explorer";
import {
  formatEth,
  formatGasCost,
  formatGwei,
  formatRpl,
  formatUnits,
  isZeroAddress,
  parseUnits,
  sameAddress,
  shortAddress,
  toBigInt,
  weiToGweiString,
} from "../units";

describe("amounts", () => {
  it("reads big integers exactly, from strings and safe numbers only", () => {
    expect(toBigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935")).toBe(2n ** 256n - 1n);
    expect(toBigInt(9007199254740991)).toBe(9007199254740991n);
    expect(toBigInt(9007199254740992)).toBeNull(); // not safe: may already be rounded
    expect(toBigInt(1.5)).toBeNull();
    expect(toBigInt("1.5")).toBeNull();
    expect(toBigInt("")).toBeNull();
    expect(toBigInt("0x10")).toBeNull();
    expect(toBigInt(undefined)).toBeNull();
    expect(toBigInt(" 42 ")).toBe(42n);
  });

  it("shows ETH rounded half up, trailing zeros dropped, never raw wei", () => {
    expect(formatEth("1000000000000000000")).toBe("1 ETH");
    expect(formatEth("1250000000000000000")).toBe("1.25 ETH");
    expect(formatEth("32041200000000000000")).toBe("32.0412 ETH");
    expect(formatEth("32041250000000000000")).toBe("32.0413 ETH"); // half up
    expect(formatEth("32041249999999999999")).toBe("32.0412 ETH");
    expect(formatEth(0)).toBe("0 ETH");
    expect(formatEth("1234567000000000000000")).toBe("1,234.567 ETH");
    expect(formatEth(6_100_000_000_000_000)).toBe("0.0061 ETH"); // a safe-integer number
  });

  it("says '< 0.0001' for a non-zero amount too small to show, and '—' for nonsense", () => {
    expect(formatEth(1)).toBe("< 0.0001 ETH");
    expect(formatEth(49_999_999_999_999)).toBe("< 0.0001 ETH");
    expect(formatEth(50_000_000_000_000)).toBe("0.0001 ETH");
    expect(formatEth(undefined)).toBe("—");
    expect(formatEth("abc")).toBe("—");
    expect(formatUnits("-1500000000000000000")).toBe("-1.5");
  });

  it("formats RPL with 2 decimals and gas costs with 6", () => {
    expect(formatRpl("1450000000000000000000")).toBe("1,450 RPL");
    expect(formatRpl("18441200000000000000")).toBe("18.44 RPL");
    expect(formatGasCost(123_250_000_000_000n)).toBe("0.000123 ETH");
    expect(formatGasCost(123_500_000_000_000n)).toBe("0.000124 ETH");
  });

  it("gwei: exact strings for requests, rounded text for people", () => {
    expect(weiToGweiString(2_700_000_000n)).toBe("2.7");
    expect(weiToGweiString(1n)).toBe("0.000000001");
    expect(weiToGweiString(3_000_000_000n)).toBe("3");
    expect(formatGwei(850_000_000)).toBe("0.85 gwei");
    expect(formatGwei(12_345_678_901)).toBe("12.35 gwei");
    expect(formatGwei(4_200_000)).toBe("0.0042 gwei");
  });

  it("parses typed amounts exactly and refuses anything unclear", () => {
    expect(parseUnits("1")).toBe(10n ** 18n);
    expect(parseUnits("0.5")).toBe(5n * 10n ** 17n);
    expect(parseUnits(".25")).toBe(25n * 10n ** 16n);
    expect(parseUnits(" 4 ")).toBe(4n * 10n ** 18n);
    expect(parseUnits("0.000000000000000001")).toBe(1n);
    expect(parseUnits("0.0000000000000000001")).toBeNull(); // more decimals than the token
    expect(parseUnits("1,5")).toBeNull(); // 1.5 or 15? never guess
    expect(parseUnits("-1")).toBeNull();
    expect(parseUnits("1e18")).toBeNull();
    expect(parseUnits("")).toBeNull();
    expect(parseUnits(".")).toBeNull();
  });

  it("addresses", () => {
    expect(isZeroAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isZeroAddress("")).toBe(true);
    expect(isZeroAddress("0x00000000000000000000000000000000000000a1")).toBe(false);
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(sameAddress("0xAbC0000000000000000000000000000000000000", "0xabc0000000000000000000000000000000000000")).toBe(true);
    expect(sameAddress(undefined, "0xabc")).toBe(false);
  });
});

describe("explorer links", () => {
  const hash = `0x${"ab".repeat(32)}`;
  it("links only real hashes and addresses, on mainnet Etherscan", () => {
    expect(isTxHash(hash)).toBe(true);
    expect(txUrl(hash)).toBe(`https://etherscan.io/tx/${hash}`);
    expect(txUrl("0x123")).toBeNull();
    expect(txUrl(`javascript:alert(1)//${hash}`)).toBeNull();
    expect(addressUrl("0x1234567890abcdef1234567890abcdef12345678")).toBe(
      "https://etherscan.io/address/0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(addressUrl("0x12")).toBeNull();
    expect(validatorUrl("ab".repeat(48))).toBe(`https://beaconcha.in/validator/0x${"ab".repeat(48)}`);
    expect(validatorUrl("nope")).toBeNull();
  });
});
