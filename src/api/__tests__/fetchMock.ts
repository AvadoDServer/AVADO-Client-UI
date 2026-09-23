/**
 * A tiny fetch double for adapter tests. Routes match on method + full URL;
 * an unmatched call fails the test loudly. Every call is recorded, with the
 * body parsed as JSON when it is JSON.
 */
export interface RecordedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string | undefined;
}

export type Reply =
  | { status?: number; json?: unknown; text?: string }
  | Error
  | ((call: RecordedCall) => Reply | Promise<Reply>)
  | "hang";

export function createFetchMock() {
  const routes: Array<{ method: string; url: string; reply: Reply; once: boolean }> = [];
  const calls: RecordedCall[] = [];

  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const rawBody = typeof init.body === "string" ? init.body : undefined;
    let body: unknown = rawBody;
    if (rawBody !== undefined) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        /* keep the text */
      }
    }
    const call: RecordedCall = { method, url, headers, body, rawBody };
    calls.push(call);

    const i = routes.findIndex((r) => r.method === method && r.url === url);
    if (i < 0) throw new Error(`fetchMock: no route for ${method} ${url}`);
    const route = routes[i];
    if (route.once) routes.splice(i, 1);

    let reply = route.reply;
    while (typeof reply === "function") reply = await reply(call);
    if (reply === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.json === undefined ? "" : JSON.stringify(reply.json));
    return new Response(status === 204 ? null : text, { status });
  };

  const api = {
    fetch: fetchImpl as unknown as typeof fetch,
    calls,
    on(method: string, url: string, reply: Reply) {
      routes.push({ method, url, reply, once: false });
      return api;
    },
    once(method: string, url: string, reply: Reply) {
      routes.push({ method, url, reply, once: true });
      return api;
    },
  };
  return api;
}

/** What a browser fetch throws when the host is down or CORS blocks it. */
export const networkDown = () => new TypeError("Failed to fetch");
