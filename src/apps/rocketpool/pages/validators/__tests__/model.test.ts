import { SCENARIOS } from "../../../api/fixtures";
import type { MegapoolStatusResponse, MegapoolValidator, MinipoolCloseDetailsResponse, MinipoolDetails, MinipoolDistributeDetailsResponse, MinipoolStatusResponse } from "../../../api/models";
import {
  exitCodeForMinipool,
  megapoolSummary,
  megapoolValidatorStatus,
  megapoolValidatorView,
  minipoolStatus,
  minipoolView,
  sortMinipools,
} from "../model";

const reads = (name: keyof typeof SCENARIOS) => SCENARIOS[name].reads;
const minipools = (name: keyof typeof SCENARIOS) => (reads(name)["minipool/status"] as MinipoolStatusResponse).minipools;
const close = (name: keyof typeof SCENARIOS) => (reads(name)["minipool/get-minipool-close-details-for-node"] as MinipoolCloseDetailsResponse).details;
const distribute = (name: keyof typeof SCENARIOS) => (reads(name)["minipool/get-distribute-balance-details"] as MinipoolDistributeDetailsResponse).details;
const mega = (name: keyof typeof SCENARIOS) => (reads(name)["megapool/status"] as MegapoolStatusResponse).megapoolDetails;

describe("minipools", () => {
  it("a staking minipool can be exited and distributed, not closed", () => {
    const [a] = minipools("minipool");
    const v = minipoolView(a, a.delegate, close("minipool"), distribute("minipool"));
    expect(v.status).toMatchObject({ label: "Staking", tone: "success" });
    expect(v).toMatchObject({ canExit: true, canDistribute: true, canClose: false });
    expect(v.delegate).toEqual({ upToDate: true, followsLatest: false });
  });

  it("an exited minipool whose ETH is back is ready to close, and can't be exited again or skimmed", () => {
    const [d, e] = minipools("exits");
    const v = minipoolView(d, d.delegate, close("exits"), distribute("exits"));
    expect(v.status).toMatchObject({ label: "Exited, ready to close", tone: "warning" });
    expect(v).toMatchObject({ canExit: false, canClose: true, canDistribute: false });
    const other = minipoolView(e, "0x0000000000000000000000000000000000000001", close("exits"), distribute("exits"));
    expect(other.delegate.upToDate).toBe(false);
    expect(sortMinipools([other, v])[0]).toBe(v); // what needs doing comes first
  });

  it("reads each state in plain words", () => {
    const [a] = minipools("minipool");
    const withStatus = (status: MinipoolDetails["status"]["status"], extra: Partial<MinipoolDetails> = {}) => ({ ...a, ...extra, status: { ...a.status, status } });
    const beacon = (state: string) => ({ ...close("minipool")![0], beaconState: state });
    expect(minipoolStatus({ ...a, finalised: true }).label).toBe("Closed");
    expect(minipoolStatus(withStatus("Dissolved")).label).toBe("Dissolved");
    expect(minipoolStatus(withStatus("Prelaunch")).label).toBe("Starting");
    expect(minipoolStatus(withStatus("Withdrawable")).label).toBe("Exited");
    expect(minipoolStatus(a, beacon("active_exiting")).label).toBe("Exiting");
    expect(minipoolStatus(a, beacon("withdrawal_possible")).label).toBe("Exiting");
    expect(minipoolStatus({ ...a, validator: { ...a.validator, exists: false } }).label).toBe("Starting");
    expect(minipoolStatus({ ...a, validator: { ...a.validator, active: false } }).label).toBe("Activating");
    // Exiting: no second exit.
    expect(minipoolView(a, a.delegate, [beacon("active_exiting")], []).canExit).toBe(false);
    // Closed: nothing to do.
    expect(minipoolView({ ...a, finalised: true }, a.delegate, close("minipool"), distribute("minipool"))).toMatchObject({ canExit: false, canDistribute: false, canClose: false });
  });

  it("the exit code is the address's last 6 characters, lower-case", () => {
    expect(exitCodeForMinipool("0xAbCdEf0123456789aBcDeF0123456789AbC3F2A1")).toBe("c3f2a1");
  });
});

describe("megapool", () => {
  it("active validators can exit; queued ones can leave the queue", () => {
    const [active, queued] = mega("mixed").validators;
    expect(megapoolValidatorView(active)).toMatchObject({ canExit: true, canLeaveQueue: false, index: "2104551", status: { label: "Active", tone: "success" } });
    expect(megapoolValidatorView(queued)).toMatchObject({ canExit: false, canLeaveQueue: true, index: null });
    expect(megapoolValidatorView(queued).status.label).toBe("In the queue (position 214)");
  });

  it("exiting, finishing and exited validators can't be exited again", () => {
    const [, exiting, locked] = mega("exits").validators;
    expect(megapoolValidatorView(exiting)).toMatchObject({ canExit: false, status: { label: "Exiting" } });
    expect(megapoolValidatorView(locked)).toMatchObject({ canExit: false, status: { label: "Finishing its exit" } });
    const base = mega("mixed").validators[0];
    const v = (o: Partial<MegapoolValidator>, beacon?: string): MegapoolValidator => ({ ...base, ...o, beaconStatus: { ...base.beaconStatus, ...(beacon !== undefined ? { status: beacon } : {}) } });
    expect(megapoolValidatorStatus(v({ exited: true })).label).toBe("Exited");
    expect(megapoolValidatorStatus(v({ dissolved: true })).label).toBe("Dissolved");
    expect(megapoolValidatorStatus(v({}, "active_slashed")).tone).toBe("danger");
    expect(megapoolValidatorStatus(v({ staked: false, inPrestake: true }, "")).label).toBe("Waiting to stake");
    expect(megapoolValidatorStatus(v({}, "pending_queued")).label).toBe("Activating");
    expect(megapoolValidatorView(v({ exited: true })).canExit).toBe(false);
  });

  it("summarises debt, refund and what is in progress", () => {
    expect(megapoolSummary(mega("exits"))).toMatchObject({ hasDebt: true, debt: 5n * 10n ** 16n, hasRefund: true, refund: 3n * 10n ** 17n, queued: 1, exiting: 1, locked: 1 });
    expect(megapoolSummary(mega("mixed"))).toMatchObject({ hasDebt: false, hasRefund: false, queued: 1 });
  });
});
