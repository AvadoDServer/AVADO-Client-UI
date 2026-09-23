/**
 * A minimal WAMP v2 caller over a JSON WebSocket: HELLO → WELCOME, then
 * CALL → RESULT | ERROR. That is all this UI needs from the DAPPMANAGER, so
 * we don't ship autobahn-browser (a large UMD bundle) for it.
 *
 * The router (DNP_WAMP, crossbar) accepts anonymous sessions on realm
 * `dappnode_admin` at ws://wamp.my.ava.do:8080/ws, the same way the old
 * wizards connected with autobahn and no auth. Like autobahn, a RESULT with
 * positional arguments resolves to the first one.
 *
 * The session opens on the first call and is reused. If it closes, pending
 * calls reject and the next call opens a new one.
 */
import { ApiError } from "./errors";

// WAMP v2 message codes
const HELLO = 1;
const WELCOME = 2;
const ABORT = 3;
const CHALLENGE = 4;
const GOODBYE = 6;
const ERROR = 8;
const CALL = 48;
const RESULT = 50;

/**
 * Router errors that mean "nobody can answer right now", not "the callee
 * refused": while the DAPPMANAGER restarts (e.g. a core update) its
 * procedures are unregistered and the router answers `no_such_procedure`.
 * These become `unreachable`, so `isClientUnavailable()` holds.
 */
const UNAVAILABLE_ERRORS = new Set(["wamp.error.no_such_procedure", "wamp.error.canceled", "wamp.error.timeout"]);

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

export interface WampOptions {
  url: string;
  realm: string;
  /** Defaults to the browser's WebSocket. */
  WebSocket?: WebSocketCtor;
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
}

interface Pending {
  procedure: string;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const OPEN = 1;

export class WampClient {
  private readonly opts: Required<Omit<WampOptions, "WebSocket">> & { WebSocket?: WebSocketCtor };
  private session: Promise<WebSocketLike> | null = null;
  private ws: WebSocketLike | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(opts: WampOptions) {
    this.opts = { connectTimeoutMs: 10_000, callTimeoutMs: 30_000, ...opts };
  }

  /** Call a procedure. Resolves to the first positional result (or the keyword results). */
  call(procedure: string, args?: unknown[], kwargs?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    return this.connect().then(
      (ws) =>
        new Promise((resolve, reject) => {
          if (ws.readyState !== OPEN) {
            reject(this.error("unreachable", procedure, "session closed"));
            return;
          }
          const id = this.nextId++;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(this.error("timeout", procedure));
          }, timeoutMs ?? this.opts.callTimeoutMs);
          this.pending.set(id, { procedure, resolve, reject, timer });
          const msg: unknown[] = [CALL, id, {}, procedure];
          if (args !== undefined || kwargs !== undefined) msg.push(args ?? []);
          if (kwargs !== undefined) msg.push(kwargs);
          ws.send(JSON.stringify(msg));
        }),
    );
  }

  /** End the session; pending calls reject. */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    this.session = null;
    this.rejectAll("closed");
    ws?.close(1000);
  }

  private error(kind: "unreachable" | "timeout" | "rejected", path: string, detail?: string) {
    return new ApiError({ kind, service: "dappmanager", path, detail });
  }

  private rejectAll(detail: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(this.error("unreachable", p.procedure, detail));
      this.pending.delete(id);
    }
  }

  private connect(): Promise<WebSocketLike> {
    if (this.session) return this.session;
    const { url, realm, connectTimeoutMs } = this.opts;
    const Ctor = this.opts.WebSocket ?? (globalThis.WebSocket as unknown as WebSocketCtor | undefined);

    const session = new Promise<WebSocketLike>((resolve, reject) => {
      if (!Ctor) {
        reject(this.error("unreachable", url, "WebSocket is not available"));
        return;
      }
      let ws: WebSocketLike;
      try {
        ws = new Ctor(url, ["wamp.2.json"]);
      } catch (e) {
        reject(this.error("unreachable", url, e instanceof Error ? e.message : String(e)));
        return;
      }
      this.ws = ws;
      let settled = false;
      const fail = (err: ApiError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(this.error("timeout", url, "no WELCOME from the router"));
        ws.close();
      }, connectTimeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify([HELLO, realm, { roles: { caller: { features: {} } }, agent: "avado-client-ui" }]));
      };
      ws.onerror = () => {
        /* onclose follows and does the work */
      };
      ws.onclose = () => {
        fail(this.error("unreachable", url, "connection closed"));
        // A socket we already replaced (close(), connect time-out) may close
        // late; its close must not touch the newer session or its calls.
        if (this.ws !== ws) return;
        this.ws = null;
        this.session = null;
        this.rejectAll("connection closed");
      };
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (!Array.isArray(msg)) return;
        switch (msg[0]) {
          case WELCOME:
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve(ws);
            }
            break;
          case ABORT: {
            const details = (msg[1] ?? {}) as { message?: string };
            fail(this.error("rejected", url, [msg[2], details.message].filter(Boolean).join(": ")));
            ws.close();
            break;
          }
          case CHALLENGE:
            fail(this.error("rejected", url, "the router asked for authentication"));
            ws.close();
            break;
          case GOODBYE:
            ws.send(JSON.stringify([GOODBYE, {}, "wamp.close.goodbye_and_out"]));
            ws.close();
            break;
          case RESULT: {
            const p = this.pending.get(msg[1] as number);
            if (!p) return;
            this.pending.delete(msg[1] as number);
            clearTimeout(p.timer);
            const args = msg[3] as unknown[] | undefined;
            p.resolve(Array.isArray(args) && args.length > 0 ? args[0] : msg[4]);
            break;
          }
          case ERROR: {
            if (msg[1] !== CALL) return;
            const p = this.pending.get(msg[2] as number);
            if (!p) return;
            this.pending.delete(msg[2] as number);
            clearTimeout(p.timer);
            const uri = String(msg[4]);
            const args = msg[5] as unknown[] | undefined;
            const text = Array.isArray(args) && typeof args[0] === "string" ? `: ${args[0]}` : "";
            p.reject(this.error(UNAVAILABLE_ERRORS.has(uri) ? "unreachable" : "rejected", p.procedure, `${uri}${text}`));
            break;
          }
        }
      };
    });

    this.session = session;
    session.catch(() => {
      if (this.session === session) this.session = null;
    });
    return session;
  }
}
