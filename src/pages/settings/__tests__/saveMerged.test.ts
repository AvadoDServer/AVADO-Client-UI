import type { PackageBackend, ProcessInfo, ServiceAction, Settings } from "../../../api/types";
import { saveSettingsMerged } from "../saveMerged";

/** A minimal PackageBackend backed by a single mutable settings object, like the real box. */
function fakeBackend(initial: Settings): PackageBackend & { saved: Settings[] } {
  let current: Settings = { ...initial };
  const saved: Settings[] = [];
  return {
    saved,
    async getSettings() {
      return { ...current };
    },
    async saveSettings(s: Settings) {
      current = { ...s }; // full overwrite, like the real backend
      saved.push({ ...s });
    },
    async getDefaultSettings() {
      return {};
    },
    async service(_action: ServiceAction) {},
    async serviceStatus(): Promise<ProcessInfo[]> {
      return [];
    },
  };
}

describe("saveSettingsMerged", () => {
  it("GETs, overlays only the patch fields, and POSTs the full object", async () => {
    const backend = fakeBackend({ validators_graffiti: "Avado", mev_boost: false });
    await saveSettingsMerged(backend, { validators_graffiti: "New graffiti" });

    expect(backend.saved).toHaveLength(1);
    expect(backend.saved[0]).toEqual({ validators_graffiti: "New graffiti", mev_boost: false });
    await expect(backend.getSettings()).resolves.toEqual({ validators_graffiti: "New graffiti", mev_boost: false });
  });

  // Review focus item 1: an old settings.json missing fields (no mev_boost or execution_engine)
  // loads, and saving one field doesn't drop the others — including fields this UI doesn't model at all.
  it("keeps fields this UI doesn't know about (unknown/legacy fields survive a save)", async () => {
    const backend = fakeBackend({
      validators_graffiti: "Avado",
      // No mev_boost, no execution_engine — an old file.
      some_future_field: "keep-me",
      p2p_peer_lower_bound: 64, // modelled by the schema, but not by this page's form
    });

    await saveSettingsMerged(backend, { validators_graffiti: "Changed" });

    const saved = backend.saved[0];
    expect(saved.validators_graffiti).toBe("Changed");
    expect(saved.some_future_field).toBe("keep-me");
    expect(saved.p2p_peer_lower_bound).toBe(64);
    expect(saved).not.toHaveProperty("mev_boost");
    expect(saved).not.toHaveProperty("execution_engine");
  });

  it("fetches fresh right before saving, so a change the box made in between (e.g. execution-engine auto-detect) survives too", async () => {
    const backend = fakeBackend({ validators_graffiti: "Avado", execution_engine: "old-engine.eth" });
    // Simulate startNimbus.sh rewriting execution_engine after the page loaded but before Save.
    await backend.saveSettings({ ...(await backend.getSettings()), execution_engine: "auto-detected-engine.eth" });

    await saveSettingsMerged(backend, { validators_graffiti: "Changed" });

    const saved = backend.saved[backend.saved.length - 1];
    expect(saved.execution_engine).toBe("auto-detected-engine.eth");
    expect(saved.validators_graffiti).toBe("Changed");
  });

  it("an empty patch still round-trips the object unchanged", async () => {
    const backend = fakeBackend({ validators_graffiti: "Avado", mev_boost: true });
    await saveSettingsMerged(backend, {});
    expect(backend.saved[0]).toEqual({ validators_graffiti: "Avado", mev_boost: true });
  });

  it("propagates a getSettings failure without calling saveSettings", async () => {
    const backend: PackageBackend = {
      getSettings: vi.fn().mockRejectedValue(new Error("network down")),
      saveSettings: vi.fn(),
      getDefaultSettings: vi.fn(),
      service: vi.fn(),
      serviceStatus: vi.fn(),
    };
    await expect(saveSettingsMerged(backend, { validators_graffiti: "x" })).rejects.toThrow("network down");
    expect(backend.saveSettings).not.toHaveBeenCalled();
  });
});
