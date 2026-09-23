import { createMockApi } from "../../../api/mock";
import type { DappManager } from "../../../api/types";
import { readPackageStates } from "../packageStates";

describe("readPackageStates", () => {
  it("uses listPackageStates when the adapter has it (running and stopped)", async () => {
    const listPackages = vi.fn();
    const dm = {
      listPackages,
      logs: vi.fn(),
      listPackageStates: vi.fn().mockResolvedValue([
        { name: "ethchain-geth.public.dappnode.eth", running: false },
        { name: "nimbus.avado.dnp.dappnode.eth", running: true },
      ]),
    } as unknown as DappManager;
    expect(await readPackageStates(dm)).toEqual([
      { name: "ethchain-geth.public.dappnode.eth", running: false },
      { name: "nimbus.avado.dnp.dappnode.eth", running: true },
    ]);
    expect(listPackages).not.toHaveBeenCalled();
  });

  it("falls back to listPackages names, counted as running", async () => {
    const api = createMockApi({ latencyMs: 0, packages: ["a.eth", "b.eth"] });
    expect(await readPackageStates(api.dappmanager)).toEqual([
      { name: "a.eth", running: true },
      { name: "b.eth", running: true },
    ]);
  });

  it("passes errors on (a failed read is unknown, never 'not installed')", async () => {
    const dm = { listPackages: vi.fn().mockRejectedValue(new Error("wamp down")), logs: vi.fn() } as unknown as DappManager;
    await expect(readPackageStates(dm)).rejects.toThrow("wamp down");
  });
});
