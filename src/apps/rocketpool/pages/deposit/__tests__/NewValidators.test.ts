import type { CanDepositResponse } from "../../../api/models";
import { blockedReasonFor } from "../NewValidators";

const can = (o: Partial<CanDepositResponse>) =>
  ({ status: "success", error: "", canDeposit: true, creditBalance: 0, nodeBalance: "5000000000000000000", insufficientBalance: false, invalidAmount: false, depositDisabled: false, ...o }) as CanDepositResponse;

describe("why a deposit is blocked (both deposit screens)", () => {
  it("lets it through only on an explicit canDeposit=true", () => {
    expect(blockedReasonFor(can({}))).toBeNull();
    const { canDeposit: _omit, ...noFlag } = can({});
    expect(blockedReasonFor(noFlag as CanDepositResponse)).toBe("Rocket Pool says this can't be done right now.");
  });

  it("names a debt first, then the wallet, then Smartnode's other reasons", () => {
    expect(blockedReasonFor(can({ canDeposit: false, nodeHasDebt: true, insufficientBalance: true }))).toMatch(/debt. Repay it first/);
    expect(blockedReasonFor(can({ canDeposit: false, insufficientBalanceWithoutCredit: true, insufficientBalance: true }))).toMatch(/credit can't be used right now/);
    expect(blockedReasonFor(can({ canDeposit: false, insufficientBalance: true, nodeBalance: "6100000000000000" }))).toMatch(/it has 0.0061 ETH/);
    expect(blockedReasonFor(can({ canDeposit: false, depositDisabled: true }))).toBe("Rocket Pool isn't taking new deposits right now.");
    expect(blockedReasonFor(can({ canDeposit: false, invalidAmount: true }))).toBe("This amount isn't allowed.");
  });
});
