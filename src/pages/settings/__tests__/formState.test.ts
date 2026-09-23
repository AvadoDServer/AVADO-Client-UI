import type { Settings } from "../../../api/types";
import {
  buildPatch,
  FEE_RECIPIENT_RE,
  graffitiByteLength,
  isPositiveInteger,
  isValidCheckpointUrl,
  toFormState,
  validateForm,
  type SettingsFormState,
} from "../formState";

const FULL_SETTINGS: Settings = {
  network: "mainnet",
  ee_endpoint: "http://ethchain-geth.my.ava.do:8551",
  execution_engine: "ethchain-geth.public.dappnode.eth",
  validators_graffiti: "My AVADO",
  p2p_peer_lower_bound: 64,
  p2p_peer_upper_bound: 100,
  validators_proposer_default_fee_recipient: "0x1111111111111111111111111111111111111111",
  initial_state: "https://sync-mainnet.beaconcha.in",
  mev_boost: true,
};

describe("toFormState", () => {
  it("reads every modelled field", () => {
    expect(toFormState(FULL_SETTINGS)).toEqual<SettingsFormState>({
      feeRecipient: "0x1111111111111111111111111111111111111111",
      graffiti: "My AVADO",
      executionEngine: "ethchain-geth.public.dappnode.eth",
      mevBoost: true,
      peerLimit: "100",
      checkpointUrl: "https://sync-mainnet.beaconcha.in",
    });
  });

  it("an old settings.json missing fields (e.g. no mev_boost or execution_engine) reads as neutral values, not a crash", () => {
    const old: Settings = { network: "mainnet", validators_graffiti: "Avado" };
    expect(toFormState(old)).toEqual<SettingsFormState>({
      feeRecipient: "",
      graffiti: "Avado",
      executionEngine: "",
      mevBoost: false,
      peerLimit: "",
      checkpointUrl: "",
    });
  });

  it("tolerates a peer-limit value stored as a string in a hand-edited file", () => {
    expect(toFormState({ p2p_peer_upper_bound: "128" as unknown as number }).peerLimit).toBe("128");
  });
});

describe("buildPatch", () => {
  const baseline = toFormState(FULL_SETTINGS);

  it("is empty when nothing changed", () => {
    expect(buildPatch(baseline, baseline)).toEqual({});
  });

  it("includes only the field the owner edited", () => {
    const form = { ...baseline, graffiti: "New graffiti" };
    expect(buildPatch(form, baseline)).toEqual({ validators_graffiti: "New graffiti" });
  });

  it("picking an execution client writes execution_engine and ee_endpoint together", () => {
    const form = { ...baseline, executionEngine: "avado-dnp-nethermind.public.dappnode.eth" };
    expect(buildPatch(form, baseline)).toEqual({
      execution_engine: "avado-dnp-nethermind.public.dappnode.eth",
      ee_endpoint: "http://avado-dnp-nethermind.my.ava.do:8551",
    });
  });

  it("an unrecognized execution engine package name still gets written, with an empty endpoint", () => {
    const form = { ...baseline, executionEngine: "someone-elses-geth.eth" };
    expect(buildPatch(form, baseline)).toEqual({ execution_engine: "someone-elses-geth.eth", ee_endpoint: "" });
  });

  it("peer limit is written as a number", () => {
    const form = { ...baseline, peerLimit: "150" };
    expect(buildPatch(form, baseline)).toEqual({ p2p_peer_upper_bound: 150 });
  });

  it("several changed fields all appear in the patch", () => {
    const form = { ...baseline, graffiti: "x", mevBoost: !baseline.mevBoost };
    expect(buildPatch(form, baseline)).toEqual({ validators_graffiti: "x", mev_boost: !baseline.mevBoost });
  });
});

describe("fee recipient validation", () => {
  it("accepts a well-formed address", () => {
    const fortyHexChars = "a1B2".repeat(10);
    expect(fortyHexChars).toHaveLength(40);
    expect(FEE_RECIPIENT_RE.test(`0x${fortyHexChars}`)).toBe(true);
  });

  it.each(["", "0x123", "1111111111111111111111111111111111111111", "0xZZZZ111111111111111111111111111111111111"])(
    "rejects %j",
    (v) => {
      expect(FEE_RECIPIENT_RE.test(v)).toBe(false);
    },
  );
});

describe("graffitiByteLength", () => {
  it("counts UTF-8 bytes, not characters", () => {
    expect(graffitiByteLength("Avado")).toBe(5);
    // Each of these emoji is 4 bytes in UTF-8, so 8 "characters" (as .length counts them) is really 32 bytes.
    expect(graffitiByteLength("🚀🚀🚀🚀🚀🚀🚀🚀")).toBe(32);
    expect("🚀🚀🚀🚀🚀🚀🚀🚀".length).not.toBe(32);
  });
});

describe("isPositiveInteger", () => {
  it.each(["1", "100", " 42 "])("accepts %j", (v) => expect(isPositiveInteger(v)).toBe(true));
  it.each(["0", "-1", "1.5", "", "abc", "1e3"])("rejects %j", (v) => expect(isPositiveInteger(v)).toBe(false));
});

describe("isValidCheckpointUrl", () => {
  it("empty is valid (optional field)", () => expect(isValidCheckpointUrl("")).toBe(true));
  it("accepts http(s) URLs", () => {
    expect(isValidCheckpointUrl("https://sync-mainnet.beaconcha.in")).toBe(true);
    expect(isValidCheckpointUrl("http://example.org/state")).toBe(true);
  });
  it.each(["not a url", "ftp://example.org/state", "javascript:alert(1)"])("rejects %j", (v) => {
    expect(isValidCheckpointUrl(v)).toBe(false);
  });
});

describe("validateForm", () => {
  const baseline: SettingsFormState = {
    feeRecipient: "0x1111111111111111111111111111111111111111",
    graffiti: "Avado",
    executionEngine: "ethchain-geth.public.dappnode.eth",
    mevBoost: false,
    peerLimit: "100",
    checkpointUrl: "",
  };

  it("a fully valid, unedited form has no errors", () => {
    expect(validateForm(baseline, baseline)).toEqual({});
  });

  it("requires a fee recipient, whether or not it was edited (an always-visible field)", () => {
    const blank = { ...baseline, feeRecipient: "" };
    expect(validateForm(blank, blank)).toHaveProperty("feeRecipient");
  });

  it("rejects a malformed fee recipient", () => {
    expect(validateForm({ ...baseline, feeRecipient: "0xnotanaddress" }, baseline)).toHaveProperty("feeRecipient");
  });

  it("rejects graffiti over 32 bytes", () => {
    const errors = validateForm({ ...baseline, graffiti: "x".repeat(33) }, baseline);
    expect(errors.graffiti).toMatch(/33 bytes/);
  });

  // Important 2 (ruling): a field missing from an old settings.json (reads as "" via
  // toFormState, matching baseline) must not block Save until the owner edits it.
  it("an untouched, missing peer limit (equal to baseline) is never an error", () => {
    const blank = { ...baseline, peerLimit: "" };
    expect(validateForm(blank, blank)).toEqual({});
  });

  it("an untouched checkpoint URL is never an error either, even if the saved value looks bogus", () => {
    // Defensive: a hand-edited file could already have a malformed value; leaving it alone must not block Save.
    const bogus = { ...baseline, checkpointUrl: "not a url" };
    expect(validateForm(bogus, bogus)).toEqual({});
  });

  it("editing the peer limit to something invalid is an error", () => {
    expect(validateForm({ ...baseline, peerLimit: "0" }, baseline).peerLimit).toBeDefined();
    expect(validateForm({ ...baseline, peerLimit: "not a number" }, baseline).peerLimit).toBeDefined();
  });

  it("editing the checkpoint URL to something invalid is an error", () => {
    expect(validateForm({ ...baseline, checkpointUrl: "not a url" }, baseline).checkpointUrl).toBeDefined();
  });

  it("editing the peer limit to a valid value has no error", () => {
    expect(validateForm({ ...baseline, peerLimit: "150" }, baseline)).toEqual({});
  });

  it("editing the checkpoint URL then clearing it back to empty is valid (it's optional)", () => {
    const editedBaseline = { ...baseline, checkpointUrl: "https://sync-mainnet.beaconcha.in" };
    expect(validateForm({ ...editedBaseline, checkpointUrl: "" }, editedBaseline)).toEqual({});
  });

  // Critical 1: validity must agree with what buildPatch would actually send, regardless of
  // which mode is currently rendering the field — see SettingsPage's mode-exit reset, which
  // guarantees peerLimit/checkpointUrl can only differ from baseline while genuinely being edited.
  it("validation doesn't take a mode flag — it only cares whether the field differs from baseline", () => {
    expect(validateForm({ ...baseline, peerLimit: "abc" }, baseline)).toHaveProperty("peerLimit");
    expect(validateForm({ ...baseline, peerLimit: "abc" }, { ...baseline, peerLimit: "abc" })).toEqual({});
  });
});
