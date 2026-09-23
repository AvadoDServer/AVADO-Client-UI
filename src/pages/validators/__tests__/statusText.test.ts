import type { ValidatorState, ValidatorStatus } from "../../../api/types";
import { MOCK_BEACON_VALIDATORS } from "../../../api/mock";
import {
  beaconchainDashboardUrl,
  beaconchainValidatorUrl,
  canExit,
  feeRecipientInfo,
  formatBalance,
  pk8,
  shortHex,
  slashingProtectionFileName,
  validatorStatusText,
  withdrawalText,
} from "../statusText";

const withStatus = (status: ValidatorStatus): ValidatorState => ({ ...MOCK_BEACON_VALIDATORS[0], status });
const ADDR = "0x1234567890abcdef1234567890abcdef12345678";

describe("validatorStatusText", () => {
  it("maps a beacon 404 (null) to Waiting for deposit, not an error", () => {
    const s = validatorStatusText(null);
    expect(s.label).toBe("Waiting for deposit");
    expect(s.tone).not.toBe("danger");
  });

  it("says the status is not available when the beacon node didn't answer", () => {
    expect(validatorStatusText(undefined).label).toBe("Status not available");
  });

  it.each([
    ["pending_initialized", "Deposit received"],
    ["pending_queued", "Waiting to activate"],
    ["active_ongoing", "Active"],
    ["active_exiting", "Exiting"],
    ["active_slashed", "Slashed"],
    ["exited_unslashed", "Exited"],
    ["exited_slashed", "Exited after slashing"],
    ["withdrawal_possible", "Exited, withdrawal pending"],
    ["withdrawal_done", "Withdrawn"],
  ] as const)("maps %s to %s", (status, label) => {
    expect(validatorStatusText(withStatus(status)).label).toBe(label);
  });

  it("marks active as success and slashed as danger", () => {
    expect(validatorStatusText(withStatus("active_ongoing")).tone).toBe("success");
    expect(validatorStatusText(withStatus("active_slashed")).tone).toBe("danger");
  });

  it("never shows a raw beacon status for an unknown one in snake case", () => {
    const s = validatorStatusText({ ...MOCK_BEACON_VALIDATORS[0], status: "something_new" as ValidatorStatus });
    expect(s.label).toBe("something new");
  });
});

describe("withdrawalText", () => {
  it("0x00 needs a withdrawal address", () => {
    const w = withdrawalText(`0x00${"ab".repeat(31)}`);
    expect(w.label).toBe("Needs a withdrawal address");
    expect(w.kind).toBe("bls");
    expect(w.tone).toBe("warning");
    expect(w.address).toBeUndefined();
  });

  it("0x01 has the withdrawal address set, and shows the address", () => {
    const w = withdrawalText(`0x01${"00".repeat(11)}${ADDR.slice(2)}`);
    expect(w.label).toBe("Withdrawal address set");
    expect(w.kind).toBe("execution");
    expect(w.address).toBe(ADDR);
  });

  it("0x02 (compounding) has the withdrawal address set too", () => {
    const w = withdrawalText(`0x02${"00".repeat(11)}${ADDR.slice(2).toUpperCase()}`);
    expect(w.label).toBe("Withdrawal address set");
    expect(w.kind).toBe("compounding");
    expect(w.address).toBe(ADDR);
  });

  it("anything else is unknown", () => {
    expect(withdrawalText(undefined).kind).toBe("unknown");
    expect(withdrawalText("0x03ff").kind).toBe("unknown");
  });

  it("covers the three mock validators", () => {
    const labels = MOCK_BEACON_VALIDATORS.slice(0, 3).map((v) => withdrawalText(v.validator.withdrawal_credentials).kind);
    expect(labels).toEqual(["execution", "compounding", "bls"]);
  });
});

describe("feeRecipientInfo", () => {
  const DEF = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  it("tells the default from an override, case-insensitively", () => {
    expect(feeRecipientInfo(DEF.toUpperCase().replace("0X", "0x"), DEF).kind).toBe("default");
    expect(feeRecipientInfo(ADDR, DEF)).toEqual({ kind: "custom", address: ADDR, label: "Custom" });
  });
  it("treats none or the zero address as the default, or Not set without one", () => {
    expect(feeRecipientInfo(null, DEF).kind).toBe("default");
    expect(feeRecipientInfo(`0x${"0".repeat(40)}`, DEF).kind).toBe("default");
    expect(feeRecipientInfo(null, "").kind).toBe("none");
  });
  it("is unknown when the keymanager didn't answer", () => {
    expect(feeRecipientInfo(undefined, DEF).kind).toBe("unknown");
  });
});

describe("helpers", () => {
  it("formats Gwei balances", () => {
    expect(formatBalance("32013456789", "mainnet")).toBe("32.0135 ETH");
    expect(formatBalance("32000000000", "gnosis")).toBe("1.0000 GNO");
    expect(formatBalance(undefined, "mainnet")).toBe("—");
  });
  it("names the slashing-protection file after the first 8 hex characters", () => {
    expect(pk8("0xABCDEF0123456789")).toBe("abcdef01");
    expect(slashingProtectionFileName("0xabcdef0123456789")).toBe("slashing-protection-abcdef01.json");
  });
  it("shortens hex", () => {
    expect(shortHex(ADDR)).toBe("0x123456…5678");
  });
  it("only allows exit for active validators", () => {
    expect(canExit(withStatus("active_ongoing"))).toBe(true);
    expect(canExit(withStatus("active_exiting"))).toBe(false);
    expect(canExit(withStatus("pending_queued"))).toBe(false);
    expect(canExit(null)).toBe(false);
  });
  it("links to beaconcha.in pages per network", () => {
    expect(beaconchainValidatorUrl("mainnet", "0xabc")).toBe("https://beaconcha.in/validator/0xabc");
    expect(beaconchainValidatorUrl("hoodi", "1")).toBe("https://hoodi.beaconcha.in/validator/1");
    expect(beaconchainDashboardUrl("gnosis", ["1", "2"])).toBe("https://gnosischa.in/dashboard?validators=1,2");
  });
});
