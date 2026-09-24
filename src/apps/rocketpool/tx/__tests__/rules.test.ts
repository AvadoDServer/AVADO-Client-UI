import { SCENARIOS } from "../../api/fixtures";
import type { CanResponse } from "../../api/models";
import { canFlag } from "../../api/sn";
import { defaultBlockedReason } from "../TransactionFlow";
import { blockedUnless, CAN_RULES } from "../rules";

const can = (flags: Record<string, unknown>): CanResponse => ({ status: "success", error: "", ...flags });

describe("can-X rules with Smartnode's real flag names", () => {
  it("the route-name default would miss these flags: that's why they have rules", () => {
    // e.g. node/can-unstake-legacy-rpl answers canUnstake, not canUnstakeLegacyRpl.
    for (const route of ["node/can-unstake-legacy-rpl", "megapool/can-exit-queue", "megapool/can-claim-refund", "node/can-withdraw-credit"]) {
      const real = CAN_RULES[route as keyof typeof CAN_RULES];
      expect(canFlag(route)).not.toBeNull();
      expect(defaultBlockedReason(can({ canUnstake: false, canExit: false, canClaim: false, canWithdraw: false }), route)).toBeNull();
      expect(real(can({ canUnstake: false, canExit: false, canClaim: false, canWithdraw: false }))).not.toBeNull();
    }
  });

  it("blocks unless the flag is true, explained by the first reason flag; a missing flag blocks", () => {
    const rule = blockedUnless("canStake", [["insufficientBalance", "Not enough"]], "Generic");
    expect(rule(can({ canStake: true }))).toBeNull();
    expect(rule(can({ canStake: false, insufficientBalance: true }))).toBe("Not enough");
    expect(rule(can({ canStake: false }))).toBe("Generic");
    expect(rule(can({}))).toBe("Generic");
  });

  it("legacy RPL: Smartnode's canUnstake ignores the 15% rule, so belowMaxRPLStake blocks here", () => {
    const rule = CAN_RULES["node/can-unstake-legacy-rpl"];
    expect(rule(can({ canUnstake: true, belowMaxRPLStake: false }))).toBeNull();
    expect(rule(can({ canUnstake: true, belowMaxRPLStake: true }))).toMatch(/15% of the ETH they borrowed/);
    expect(rule(can({ canUnstake: false, hasDifferentRPLWithdrawalAddress: true }))).toMatch(/separate RPL withdrawal address/);
  });

  it("every demo can-X answer for a ruled route uses the real flag", () => {
    for (const s of Object.values(SCENARIOS)) {
      for (const [route, rule] of Object.entries(CAN_RULES)) {
        const answer = s.reads[route] as CanResponse | undefined;
        if (!answer || !("gasLimits" in answer)) continue;
        // A ready answer passes; the only way to block is a false flag or a reason.
        const reason = rule(answer);
        const flags = Object.entries(answer).filter(([k, v]) => k.startsWith("can") && typeof v === "boolean");
        expect(flags.length, `${s.name} ${route}`).toBeGreaterThan(0);
        if (flags.every(([, v]) => v === true) && answer.belowMaxRPLStake !== true) expect(reason, `${s.name} ${route}`).toBeNull();
      }
    }
  });
});
