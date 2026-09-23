import { DEFAULT_PRIORITY_FEE_WEI, gasParams, quoteGas } from "../gas";

describe("gas quote", () => {
  it("prices the estimate at base fee + tip and caps it at safe limit × (2 × base fee + tip)", () => {
    const q = quoteGas({ estimated: 145_000, safe: 217_500 }, 850_000_000)!;
    expect(q.priorityFeeWei).toBe(DEFAULT_PRIORITY_FEE_WEI);
    expect(q.estimatedCostWei).toBe(145_000n * (850_000_000n + 1_000_000_000n));
    expect(q.maxFeeWei).toBe(2n * 850_000_000n + 1_000_000_000n);
    expect(q.maxCostWei).toBe(217_500n * 2_700_000_000n);
    expect(q.maxCostWei).toBeGreaterThanOrEqual(q.estimatedCostWei);
  });

  it("sends exactly the numbers the owner saw", () => {
    const q = quoteGas({ estimated: 145_000, safe: 217_500 }, "850000000")!;
    expect(gasParams(q)).toEqual({ maxFee: "2.7", maxPrioFee: "1", gasLimit: "217500" });
  });

  it("never uses a safe limit below the estimate", () => {
    const q = quoteGas({ estimated: 100_000, safe: 50_000 }, 1_000_000_000)!;
    expect(q.gasLimit).toBe(100_000);
  });

  it("has no quote without a usable estimate or base fee", () => {
    expect(quoteGas(undefined, 1)).toBeNull();
    expect(quoteGas({ estimated: 0, safe: 0 }, 1)).toBeNull();
    expect(quoteGas({ estimated: 21_000, safe: 30_000 }, undefined)).toBeNull();
    expect(quoteGas({ estimated: 21_000, safe: 30_000 }, "garbage")).toBeNull();
    expect(quoteGas({ estimated: 21_000, safe: 30_000 }, -1)).toBeNull();
  });
});
