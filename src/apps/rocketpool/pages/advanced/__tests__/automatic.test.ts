import { SCENARIOS } from "../../../api/fixtures";
import { daemonSettings, gweiToWei, TEMPLATE_SETTINGS, underThreshold } from "../automatic";

describe("automatic actions", () => {
  it("uses the reported settings, else the package template's", () => {
    expect(daemonSettings(SCENARIOS.minipool.avado)).toEqual({ values: TEMPLATE_SETTINGS, reported: false });
    expect(daemonSettings({ ...SCENARIOS.minipool.avado, settings: { autoTxGasThreshold: "35" } })).toEqual({
      values: { ...TEMPLATE_SETTINGS, autoTxGasThreshold: "35" },
      reported: true,
    });
    expect(TEMPLATE_SETTINGS.autoTxGasThreshold).toBe("20");
  });

  it("compares the base fee with the limit exactly", () => {
    expect(gweiToWei("20")).toBe(20_000_000_000n);
    expect(gweiToWei("0.01")).toBe(10_000_000n);
    expect(gweiToWei("1e3")).toBeNull();
    expect(underThreshold(850_000_000, "20")).toBe(true);
    expect(underThreshold("20000000000", "20")).toBe(false);
    expect(underThreshold(undefined, "20")).toBeNull();
    expect(underThreshold(1, "abc")).toBeNull();
  });
});
