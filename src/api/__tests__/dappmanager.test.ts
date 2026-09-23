import { createDappManager, unwrapEnvelope, WAMP_REALM, WAMP_URL, type WampCaller } from "../dappmanager";

type Call = { procedure: string; args?: unknown[]; kwargs?: Record<string, unknown> };

function fakeCaller(reply: (c: Call) => unknown): WampCaller & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async call(procedure, args, kwargs) {
      const c = { procedure, args, kwargs };
      calls.push(c);
      return reply(c);
    },
  };
}

const PACKAGES = [
  { name: "nimbus.avado.dnp.dappnode.eth", running: true, state: "running" },
  { name: "ethchain-geth.public.dappnode.eth", running: true, state: "running" },
  { name: "mevboost.avado.dnp.dappnode.eth", running: false, state: "exited" },
];

describe("createDappManager", () => {
  it("uses the DAPPMANAGER router and realm (spec §2.6)", () => {
    expect(WAMP_URL).toBe("ws://wamp.my.ava.do:8080/ws");
    expect(WAMP_REALM).toBe("dappnode_admin");
  });

  it("listPackages calls listPackages.dappmanager.dnp.dappnode.eth, JSON.parses the envelope and returns running package names", async () => {
    const wamp = fakeCaller(() => JSON.stringify({ success: true, message: "Listing 3 packages", result: PACKAGES }));
    const names = await createDappManager({ wamp }).listPackages();
    expect(wamp.calls[0].procedure).toBe("listPackages.dappmanager.dnp.dappnode.eth");
    // Same rule as the old wizards: only running packages count.
    expect(names).toEqual(["nimbus.avado.dnp.dappnode.eth", "ethchain-geth.public.dappnode.eth"]);
  });

  it("logs calls logPackage with {id, options:{tail}} and returns the text", async () => {
    const wamp = fakeCaller(() => JSON.stringify({ success: true, message: "Got logs", result: "line 1\nline 2\n" }));
    const text = await createDappManager({ wamp }).logs("nimbus.avado.dnp.dappnode.eth", 20);
    expect(wamp.calls[0]).toEqual({
      procedure: "logPackage.dappmanager.dnp.dappnode.eth",
      args: [],
      kwargs: { id: "nimbus.avado.dnp.dappnode.eth", options: { tail: 20 } },
    });
    expect(text).toBe("line 1\nline 2\n");
  });

  it("success: false is a 'rejected' ApiError with DAPPMANAGER's message", async () => {
    const wamp = fakeCaller(() => JSON.stringify({ success: false, message: "No docker-compose found" }));
    await expect(createDappManager({ wamp }).logs("x", 20)).rejects.toMatchObject({
      kind: "rejected",
      service: "dappmanager",
      path: "logPackage.dappmanager.dnp.dappnode.eth",
      detail: "No docker-compose found",
    });
  });

  it("an unparseable envelope is 'invalid'", async () => {
    const wamp = fakeCaller(() => "<not json>");
    await expect(createDappManager({ wamp }).listPackages()).rejects.toMatchObject({ kind: "invalid" });
  });

  it("listPackages rejects a result that is not a list", async () => {
    const wamp = fakeCaller(() => JSON.stringify({ success: true, result: {} }));
    await expect(createDappManager({ wamp }).listPackages()).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("unwrapEnvelope", () => {
  it("accepts an already-parsed envelope too", () => {
    expect(unwrapEnvelope({ success: true, result: 1 }, "p")).toBe(1);
  });
});
