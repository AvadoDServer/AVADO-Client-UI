import { ApiError } from "../errors";
import { WampClient, type WebSocketLike } from "../wamp";

/** A scripted WebSocket: records what the client sends; the test plays the router. */
class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  sent: unknown[][] = [];
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  /** When true, close() only starts closing; the test calls finishClose() later (like a real close handshake). */
  deferClose = false;
  close() {
    if (this.readyState >= 2) return;
    if (this.deferClose) {
      this.readyState = 2;
      return;
    }
    this.readyState = 3;
    this.onclose?.({});
  }
  finishClose() {
    this.readyState = 3;
    this.onclose?.({});
  }
  // router side
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(msg: unknown[]) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  welcome() {
    this.open();
    this.deliver([2, 12345, { roles: { dealer: {} } }]);
  }
  lastCall() {
    const call = [...this.sent].reverse().find((m) => m[0] === 48);
    if (!call) throw new Error("no CALL sent");
    return call;
  }
}

const URL = "ws://wamp.my.ava.do:8080/ws";
const make = (opts: Partial<ConstructorParameters<typeof WampClient>[0]> = {}) =>
  new WampClient({ url: URL, realm: "dappnode_admin", WebSocket: FakeSocket, ...opts });

beforeEach(() => {
  FakeSocket.all = [];
});

describe("WampClient", () => {
  it("opens a wamp.2.json socket, says HELLO to the realm and CALLs after WELCOME", async () => {
    const client = make();
    const p = client.call("listPackages.dappmanager.dnp.dappnode.eth");
    const ws = FakeSocket.all[0];
    expect(ws.url).toBe(URL);
    expect(ws.protocols).toEqual(["wamp.2.json"]);
    ws.welcome();
    expect(ws.sent[0][0]).toBe(1);
    expect(ws.sent[0][1]).toBe("dappnode_admin");
    expect(ws.sent[0][2]).toMatchObject({ roles: { caller: {} } });

    await Promise.resolve();
    const call = ws.lastCall();
    expect(call[3]).toBe("listPackages.dappmanager.dnp.dappnode.eth");
    ws.deliver([50, call[1], {}, ['{"success":true,"result":[]}']]);
    expect(await p).toBe('{"success":true,"result":[]}');
  });

  it("sends args and kwargs, and reuses one session for later calls", async () => {
    const client = make();
    const p1 = client.call("logPackage.dappmanager.dnp.dappnode.eth", [], { id: "x", options: { tail: 20 } });
    const ws = FakeSocket.all[0];
    ws.welcome();
    await Promise.resolve();
    const c1 = ws.lastCall();
    expect(c1.slice(3)).toEqual(["logPackage.dappmanager.dnp.dappnode.eth", [], { id: "x", options: { tail: 20 } }]);
    ws.deliver([50, c1[1], {}, ["logs"]]);
    await p1;

    const p2 = client.call("listPackages.dappmanager.dnp.dappnode.eth");
    await Promise.resolve();
    const c2 = ws.lastCall();
    expect(c2[1]).not.toBe(c1[1]);
    ws.deliver([50, c2[1], {}, ["second"]]);
    expect(await p2).toBe("second");
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("matches results to calls by request id", async () => {
    const client = make();
    const a = client.call("a");
    const b = client.call("b");
    const ws = FakeSocket.all[0];
    ws.welcome();
    await Promise.resolve();
    const calls = ws.sent.filter((m) => m[0] === 48);
    const idOf = (proc: string) => calls.find((c) => c[3] === proc)![1];
    ws.deliver([50, idOf("b"), {}, ["B"]]);
    ws.deliver([50, idOf("a"), {}, ["A"]]);
    expect(await a).toBe("A");
    expect(await b).toBe("B");
  });

  it("a WAMP ERROR from the callee rejects that call with a 'rejected' ApiError", async () => {
    const client = make();
    const p = client.call("x").catch((e) => e);
    const ws = FakeSocket.all[0];
    ws.welcome();
    await Promise.resolve();
    ws.deliver([8, 48, ws.lastCall()[1], {}, "wamp.error.invalid_argument", ["bad kwargs"]]);
    const err = (await p) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: "rejected", service: "dappmanager", path: "x" });
    expect(err.detail).toMatch(/invalid_argument: bad kwargs/);
  });

  it.each(["wamp.error.no_such_procedure", "wamp.error.canceled", "wamp.error.timeout"])(
    "%s (e.g. the DAPPMANAGER is restarting) is 'unreachable', not a refusal",
    async (uri) => {
      const client = make();
      const p = client.call("listPackages.dappmanager.dnp.dappnode.eth").catch((e) => e);
      const ws = FakeSocket.all[0];
      ws.welcome();
      await Promise.resolve();
      ws.deliver([8, 48, ws.lastCall()[1], {}, uri, []]);
      const err = (await p) as ApiError;
      expect(err).toMatchObject({ kind: "unreachable", service: "dappmanager" });
      expect(err.detail).toContain(uri);
    },
  );

  it("an old socket closing late does not reject the calls of a newer session", async () => {
    const client = make();
    const first = client.call("x").catch((e) => e);
    const old = FakeSocket.all[0];
    old.deferClose = true;
    old.welcome();
    await Promise.resolve();
    client.close(); // old socket is still closing
    expect(await first).toMatchObject({ kind: "unreachable" });

    const second = client.call("y");
    const ws = FakeSocket.all[1];
    ws.welcome();
    await Promise.resolve();
    old.finishClose(); // the old close event arrives now
    ws.deliver([50, ws.lastCall()[1], {}, ["ok"]]);
    expect(await second).toBe("ok");
  });

  it("a connect time-out followed by a retry: the timed-out socket's late close is ignored", async () => {
    vi.useFakeTimers();
    try {
      const client = make({ connectTimeoutMs: 500 });
      const first = client.call("x").catch((e) => e);
      const old = FakeSocket.all[0];
      old.deferClose = true;
      old.open();
      await vi.advanceTimersByTimeAsync(501);
      expect(await first).toMatchObject({ kind: "timeout" });

      const second = client.call("y");
      const ws = FakeSocket.all[1];
      ws.welcome();
      await Promise.resolve();
      old.finishClose();
      ws.deliver([50, ws.lastCall()[1], {}, ["ok"]]);
      expect(await second).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an ABORT during HELLO rejects with 'rejected'", async () => {
    const client = make();
    const p = client.call("x").catch((e) => e);
    const ws = FakeSocket.all[0];
    ws.open();
    ws.deliver([3, { message: "no such realm" }, "wamp.error.no_such_realm"]);
    expect(await p).toMatchObject({ kind: "rejected", detail: expect.stringMatching(/no_such_realm/) });
  });

  it("a socket that cannot connect rejects with 'unreachable', and the next call tries again", async () => {
    const client = make();
    const p = client.call("x").catch((e) => e);
    FakeSocket.all[0].onerror?.({});
    FakeSocket.all[0].close();
    expect(await p).toMatchObject({ kind: "unreachable", service: "dappmanager" });

    const p2 = client.call("y");
    expect(FakeSocket.all).toHaveLength(2);
    const ws = FakeSocket.all[1];
    ws.welcome();
    await Promise.resolve();
    ws.deliver([50, ws.lastCall()[1], {}, ["ok"]]);
    expect(await p2).toBe("ok");
  });

  it("losing the session rejects pending calls with 'unreachable'", async () => {
    const client = make();
    const p = client.call("x").catch((e) => e);
    const ws = FakeSocket.all[0];
    ws.welcome();
    await Promise.resolve();
    ws.close();
    expect(await p).toMatchObject({ kind: "unreachable" });
  });

  it("times out a call with no RESULT", async () => {
    vi.useFakeTimers();
    try {
      const client = make({ callTimeoutMs: 1000 });
      const p = client.call("slow").catch((e) => e);
      FakeSocket.all[0].welcome();
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toMatchObject({ kind: "timeout", path: "slow" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out a connection that never gets a WELCOME", async () => {
    vi.useFakeTimers();
    try {
      const client = make({ connectTimeoutMs: 500 });
      const p = client.call("x").catch((e) => e);
      FakeSocket.all[0].open();
      await vi.advanceTimersByTimeAsync(501);
      expect(await p).toMatchObject({ kind: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a router GOODBYE and reconnects on the next call", async () => {
    const client = make();
    const p = client.call("x");
    const ws = FakeSocket.all[0];
    ws.welcome();
    await Promise.resolve();
    ws.deliver([50, ws.lastCall()[1], {}, ["ok"]]);
    await p;
    ws.deliver([6, {}, "wamp.close.system_shutdown"]);
    expect(ws.sent.at(-1)?.[0]).toBe(6);
    expect(ws.readyState).toBe(3);
    void client.call("y").catch(() => {});
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("close() ends the session", async () => {
    const client = make();
    const p = client.call("x").catch((e) => e);
    FakeSocket.all[0].welcome();
    await Promise.resolve();
    client.close();
    expect(await p).toMatchObject({ kind: "unreachable" });
    expect(FakeSocket.all[0].readyState).toBe(3);
  });
});
