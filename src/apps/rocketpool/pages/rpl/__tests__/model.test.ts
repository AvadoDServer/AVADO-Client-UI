import { DEMO, SCENARIOS } from "../../../api/fixtures";
import type { NodeStatus } from "../../../api/models";
import { checkAmount, rplView, unstakeEffect } from "../model";

const ETH = 10n ** 18n;
const node = (name: keyof typeof SCENARIOS) => SCENARIOS[name].reads["node/status"] as NodeStatus;
const NOW = Date.parse("2026-09-23T10:00:00Z");
const DAY = 86_400_000;

describe("RPL", () => {
  it("legacy RPL: only what is above the minimum (and not locked) can be unstaked", () => {
    const v = rplView(node("minipool"), NOW);
    expect(v).toMatchObject({ legacy: 1450n * ETH, legacyMinimum: 3105n * ETH / 10n, legacyUnstakable: 1450n * ETH - 3105n * ETH / 10n, minimumPercent: 15 });
    const locked = rplView({ ...node("minipool"), nodeRPLLocked: String(1200n * ETH) }, NOW);
    expect(locked.legacyUnstakable).toBe(0n); // 1450 - 1200 - 310.5 < 0
  });

  it("unstaking: waiting until the period has passed on the chain's clock, then ready", () => {
    const exits = node("exits"); // unstaked 2026-08-20, 28 days → 2026-09-17; chain time 2026-09-23
    expect(rplView(exits, NOW)).toMatchObject({ unstaking: 300n * ETH, unstakingState: "ready", periodMs: 28 * DAY });
    expect(rplView(exits, NOW).withdrawableAt).toBe(Date.parse("2026-09-17T10:00:00Z"));
    const recent = { ...exits, lastRPLUnstakeTime: "2026-09-20T10:00:00Z" };
    expect(rplView(recent, NOW)).toMatchObject({ unstakingState: "waiting", withdrawableAt: Date.parse("2026-10-18T10:00:00Z") });
    // Without the chain's time, the given clock decides.
    expect(rplView({ ...recent, latestBlockTime: undefined }, Date.parse("2026-11-01T00:00:00Z")).unstakingState).toBe("ready");
    expect(rplView(node("minipool"), NOW)).toMatchObject({ unstaking: 0n, unstakingState: "none", withdrawableAt: null });
  });

  it("a separate RPL withdrawal address means the node can't unstake or withdraw", () => {
    expect(rplView(node("minipool"), NOW).otherRplAddress).toBeNull();
    const other = rplView({ ...node("minipool"), isRPLWithdrawalAddressSet: true, rplWithdrawalAddress: DEMO.coldWallet }, NOW);
    expect(other.otherRplAddress).toBe(DEMO.coldWallet);
    expect(rplView({ ...node("minipool"), isRPLWithdrawalAddressSet: true, rplWithdrawalAddress: DEMO.nodeAddress }, NOW).otherRplAddress).toBeNull();
  });

  it("checks typed amounts against the maximum", () => {
    expect(checkAmount(null, "", 5n)).toEqual({ wei: null });
    expect(checkAmount(null, "1,5", 5n).error).toMatch(/a dot for decimals/);
    expect(checkAmount(0n, "0", 5n).error).toBe("Enter more than 0.");
    expect(checkAmount(6n, "6", 5n).error).toBe("That is more than is available.");
    expect(checkAmount(5n, "5", 5n)).toEqual({ wei: 5n });
  });

  it("megapool RPL: at most the megapool stake, and never locked RPL (CLI rule)", () => {
    const exits = node("exits"); // megapool 200, total 1100
    expect(rplView(exits, NOW).megapoolUnstakable).toBe(200n * ETH);
    expect(rplView({ ...exits, nodeRPLLocked: String(1000n * ETH) }, NOW).megapoolUnstakable).toBe(100n * ETH);
  });

  it("I2: unstaking more restarts the wait for everything still unstaking; ready RPL is paid out first", () => {
    const exits = node("exits");
    expect(unstakeEffect(rplView(node("minipool"), NOW), NOW)).toEqual({ kind: "none" });
    expect(unstakeEffect(rplView(exits, NOW), NOW)).toEqual({ kind: "ready", amount: 300n * ETH });
    const waiting = rplView({ ...exits, lastRPLUnstakeTime: "2026-09-20T10:00:00Z" }, NOW);
    expect(unstakeEffect(waiting, NOW)).toEqual({
      kind: "restart",
      amount: 300n * ETH,
      currentEnd: Date.parse("2026-10-18T10:00:00Z"),
      newEnd: NOW + 28 * DAY,
    });
  });
});
