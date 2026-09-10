import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { Server } from "node:http";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createExaMcpClient } from "../src/exa-mcp-client.ts";
import { createStateStore } from "../src/state-store.ts";
import { loginOAuth } from "../src/oauth-login.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import { deferred } from "./fixtures/oauth-server.ts";
import { forwardLogin, loginServer } from "./fixtures/login-server.ts";

let directory: string;
let store: ReturnType<typeof createStateStore>;
const clients: ReturnType<typeof createExaMcpClient>[] = [];
const servers: Awaited<ReturnType<typeof loginServer>>[] = [];
const nativeFetch = globalThis.fetch;
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "pi-exa-login-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  store = createStateStore();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await fs.rm(directory, { recursive: true, force: true });
});
async function setup(handle?: Parameters<typeof loginServer>[0]) {
  const server = await loginServer(handle);
  servers.push(server);
  vi.stubGlobal("fetch", forwardLogin(server.origin, nativeFetch));
  const client = createExaMcpClient({ apiKey: " key-sentinel " });
  clients.push(client);
  return { client, server };
}
function start(client: ReturnType<typeof createExaMcpClient>, signal?: AbortSignal) {
  let ready!: (url: URL) => void;
  const authorization = new Promise<URL>((resolve) => {
    ready = resolve;
  });
  const outcome = client.login(ready, signal);
  // Attach immediately; callback and injected failures can finish before assertions are reached.
  void outcome.catch(() => {});
  return { authorization, outcome };
}

test("login validates and commits an SSE initialize result without waiting for stream EOF", async () => {
  const closed = deferred();
  const { client, server } = await setup((request) => {
    if (request.message.method !== "initialize") return undefined;
    return {
      headers: { "mcp-session-id": "login-sse-session" },
      sse: {
        messages: [
          {
            jsonrpc: "2.0",
            id: request.message.id,
            result: {
              protocolVersion: request.message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "sse-fixture", version: "1" },
            },
          },
        ],
        onClose: closed.resolve,
      },
    };
  });
  const login = start(client);
  await nativeFetch(server.callbackURL(await login.authorization));
  await login.outcome;
  await closed.promise;
  expect((await store.readOAuth()).revision).toBe(1);
  expect(
    server.requests.some((request) => request.message.method === "notifications/initialized"),
  ).toBe(true);
  expect(server.requests.filter((request) => request.message.method === "tools/call")).toEqual([]);
});

test.each(["caller", "shutdown"])(
  "%s interrupts validation while awaiting an initialize result on SSE",
  async (mode) => {
    const consumed = deferred(),
      closed = deferred();
    const previous = await store.updateOAuth(async () => credentials);
    const { client, server } = await setup((request) => {
      if (request.message.id === "validation-ping") consumed.resolve();
      if (request.message.method !== "initialize") return undefined;
      return {
        sse: {
          // The ping response proves the SDK is reading SSE while initialization remains pending.
          messages: [{ jsonrpc: "2.0", id: "validation-ping", method: "ping" }],
          onClose: closed.resolve,
        },
      };
    });
    const controller = new AbortController();
    const reason = new Error("login-sentinel abort", { cause: "login-sentinel" });
    const login = start(client, controller.signal);
    await nativeFetch(server.callbackURL(await login.authorization));
    await consumed.promise;
    if (mode === "caller") {
      controller.abort(reason);
      await expect(login.outcome).rejects.toBe(reason);
    } else {
      await client.close();
      await expect(login.outcome).rejects.toMatchObject({ code: "lifecycle" });
    }
    await closed.promise;
    expect(await store.readOAuth()).toEqual(previous);
    expect(server.requests.filter((request) => request.message.method === "tools/call")).toEqual(
      [],
    );
  },
);

test.each(["anonymous-first", "authenticated-first"] as const)(
  "%s: real discovery, registration, PKCE exchange, validation, commit and both tools",
  async (strategy) => {
    await store.writeSettings({ version: 1, strategy });
    const { client, server } = await setup((request) =>
      request.path === "/mcp" && request.message.method === "tools/call"
        ? { status: 429, headers: { "retry-after": "30" } }
        : undefined,
    );
    const closed = vi.spyOn(StreamableHTTPClientTransport.prototype, "close");
    const login = start(client);
    const url = await login.authorization;
    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("mcp offline_access");
    expect(url.searchParams.get("resource")).toBe(credentials.resource);
    expect(url.searchParams.get("state")!.length).toBeGreaterThanOrEqual(32);
    const redirect = new URL(url.searchParams.get("redirect_uri")!);
    expect(redirect.hostname).toBe("127.0.0.1");
    expect(Number(redirect.port)).toBeGreaterThan(0);
    expect(redirect.pathname).toBe("/callback");
    expect((await store.readOAuth()).revision).toBe(0);
    const before = Date.now();
    const response = await nativeFetch(server.callbackURL(url));
    expect(await response.text()).toBe("Login callback received. Return to Pi for the result.");
    await login.outcome;
    const committed = await store.readOAuth();
    expect(committed.revision).toBe(1);
    expect(committed.credentials).toMatchObject({
      loginRequired: false,
      resource: credentials.resource,
      tokens: { access_token: "login-sentinel-access", issuer: "https://auth.example.test" },
      clientInformation: { issuer: "https://auth.example.test", redirect_uris: [redirect.href] },
      discovery: { authorizationServerMetadata: { issuer: "https://auth.example.test" } },
    });
    expect(committed.credentials!.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(committed.credentials!.expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
    const json = await fs.readFile(join(directory, "exa-web/oauth.json"), "utf8");
    for (const secret of [
      url.href,
      url.searchParams.get("state")!,
      "login-sentinel-code-1",
      "key-sentinel",
      ...server.requests.flatMap((request) =>
        request.form.has("code_verifier") ? [request.form.get("code_verifier")!] : [],
      ),
    ])
      expect(json).not.toContain(secret);
    expect(server.requests.filter((r) => r.message.method === "initialize")).toHaveLength(1);
    expect(server.requests.filter((r) => r.message.method === "tools/call")).toEqual([]);
    expect(closed).toHaveBeenCalled();
    await expect(client.search({ query: "fixture" }, undefined)).resolves.toMatchObject({
      auth: "oauth",
      text: "first\n\nsecond",
    });
    await expect(client.fetch({ url: "https://example.com" }, undefined)).resolves.toMatchObject({
      auth: "oauth",
    });
    expect(
      server.requests.filter((r) => r.path === "/mcp/oauth" && r.message.method === "initialize"),
    ).toHaveLength(2);
    expect(server.requests.every((r) => !r.headers["x-api-key"])).toBe(true);
    await expect(nativeFetch(redirect)).rejects.toThrow();
  },
);

test("shutdown cancels a pending login while three normal routes share one termination grace", async () => {
  const entered = deferred(),
    release = deferred();
  let deletes = 0;
  const { client, server } = await setup(async (request) => {
    if (request.method === "DELETE") {
      if (++deletes === 3) entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  await client.search({ query: "anonymous" }, undefined);
  await client.setStrategy("authenticated-first");
  await client.search({ query: "key" }, undefined);
  await store.updateOAuth(async () => credentials);
  await client.search({ query: "oauth" }, undefined);
  const login = start(client);
  const url = await login.authorization;
  const before = performance.now();
  const closing = client.close();
  await entered.promise;
  await closing;
  expect(performance.now() - before).toBeLessThan(1_800);
  await expect(login.outcome).rejects.toMatchObject({ code: "lifecycle" });
  await expect(nativeFetch(url.searchParams.get("redirect_uri")!)).rejects.toThrow();
  expect(server.requests.filter((request) => request.path === "/token")).toEqual([]);
  release.resolve();
}, 3_000);

test.each([
  "missing-state",
  "wrong-state",
  "duplicate-state",
  "duplicate-code",
  "duplicate-issuer",
  "code-and-error",
  "empty",
  "denied",
  "issuer",
])("rejects %s callback without changing old credentials", async (mode) => {
  const previous = await store.updateOAuth(async () => credentials);
  const { client, server } = await setup();
  const login = start(client);
  const url = server.callbackURL(await login.authorization);
  if (mode === "missing-state") url.searchParams.delete("state");
  if (mode === "wrong-state") url.searchParams.set("state", "login-sentinel-wrong");
  if (mode.startsWith("duplicate-")) {
    const key = mode === "duplicate-issuer" ? "iss" : mode.slice("duplicate-".length);
    url.searchParams.append(key, url.searchParams.get(key)!);
  }
  if (mode === "code-and-error") url.searchParams.set("error", "access_denied");
  if (mode === "empty" || mode === "denied") url.searchParams.delete("code");
  if (mode === "denied") {
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "login-sentinel");
  }
  if (mode === "issuer") url.searchParams.set("iss", "https://login-sentinel.example");
  const response = await nativeFetch(url);
  expect(await response.text()).not.toContain("sentinel");
  const error = await login.outcome.catch((value: unknown) => value);
  expect(error).toMatchObject({ code: mode === "denied" ? "login-denied" : "authentication" });
  expect(inspect(error, { depth: 20, showHidden: true })).not.toContain("sentinel");
  expect(error).not.toHaveProperty("cause");
  expect(await store.readOAuth()).toEqual(previous);
  expect(server.requests.filter((r) => r.path === "/token")).toEqual([]);
});

test("unrelated requests do not consume the callback; duplicate accepted callback aborts exchange", async () => {
  const entered = deferred(),
    release = deferred();
  const { client, server } = await setup(async (request) => {
    if (request.path === "/token") {
      entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  const login = start(client);
  const url = server.callbackURL(await login.authorization);
  expect((await nativeFetch(new URL("/other", url))).status).toBe(404);
  expect((await nativeFetch(url, { method: "POST" })).status).toBe(405);
  expect((await nativeFetch(url)).status).toBe(200);
  await entered.promise;
  expect((await nativeFetch(url)).status).toBe(400);
  await expect(login.outcome).rejects.toMatchObject({ code: "authentication" });
  release.resolve();
  expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
  expect((await store.readOAuth()).revision).toBe(0);
});

test.each(["exchange", "initialize-401", "initialize-403", "rename", "close"])(
  "%s failure preserves previous credentials and never refreshes or sends a tool",
  async (mode) => {
    const previous = await store.updateOAuth(async () => credentials);
    const { client, server } = await setup((request) => {
      if (mode === "exchange" && request.path === "/token") return { status: 503 };
      if (mode.startsWith("initialize-") && request.message.method === "initialize")
        return {
          status: mode === "initialize-401" ? 401 : 403,
          headers: {
            "www-authenticate": 'Bearer error="insufficient_scope", scope="login-sentinel"',
          },
        };
      return undefined;
    });
    const login = start(client);
    const url = server.callbackURL(await login.authorization);
    if (mode === "rename")
      vi.spyOn(fs, "rename").mockRejectedValue(
        new Error("login-sentinel", { cause: "login-sentinel" }),
      );
    if (mode === "close") {
      const close = Reflect.get(StreamableHTTPClientTransport.prototype, "close");
      vi.spyOn(StreamableHTTPClientTransport.prototype, "close").mockImplementation(
        async function (this: StreamableHTTPClientTransport) {
          await close.call(this);
          throw new Error("login-sentinel");
        },
      );
    }
    await nativeFetch(url);
    const error = await login.outcome.catch((value: unknown) => value);
    expect(error).toMatchObject({
      code:
        mode === "rename" || mode === "close"
          ? "storage"
          : mode === "exchange"
            ? "server"
            : "authentication",
    });
    expect(inspect(error, { showHidden: true, depth: 20 })).not.toContain("sentinel");
    expect(await store.readOAuth()).toEqual(previous);
    expect(server.requests.filter((r) => r.form.get("grant_type") === "refresh_token")).toEqual([]);
    expect(server.requests.filter((r) => r.message.method === "tools/call")).toEqual([]);
    expect(server.requests.filter((r) => r.path === "/register")).toHaveLength(1);
  },
);

test("bind failure is safe and starts no authorization request", async () => {
  const { client, server } = await setup();
  vi.spyOn(Server.prototype, "listen").mockImplementation(() => {
    throw new Error("login-sentinel");
  });
  await expect(
    client.login(() => {
      throw new Error("unexpected URL");
    }),
  ).rejects.toMatchObject({ code: "authentication" });
  expect(server.requests).toEqual([]);
  expect(await fs.readdir(directory)).toEqual([]);
});

test("one login per client; logout wins revision comparison while browser wait holds no lock", async () => {
  const { client, server } = await setup();
  const login = start(client);
  const url = await login.authorization;
  await expect(client.login(() => {})).rejects.toMatchObject({ code: "login-in-progress" });
  await client.logout();
  await nativeFetch(server.callbackURL(url));
  await expect(login.outcome).rejects.toMatchObject({ code: "storage-conflict" });
  expect(await store.readOAuth()).toEqual({ version: 1, revision: 1, credentials: null });
  expect(server.requests.filter((r) => r.path === "/register")).toHaveLength(1);
});

test.each(["caller", "shutdown", "timeout"])(
  "%s cancels callback waiting and closes the listener",
  async (mode) => {
    const { client } = await setup();
    const controller = new AbortController();
    const reason = new Error("login-sentinel", { cause: "login-sentinel" });
    const realTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    if (mode === "timeout")
      vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, milliseconds, ...args) => {
        if (milliseconds === 300_000) expire = () => callback(...args);
        return realTimeout(callback, milliseconds, ...args);
      });
    const login = start(client, controller.signal);
    const url = await login.authorization;
    if (mode === "caller") controller.abort(reason);
    if (mode === "shutdown") {
      const closing = client.close();
      expect(client.close()).toBe(closing);
      await closing;
    }
    // Fire only the five-minute deadline, leaving the HTTP fixture's clocks untouched.
    if (mode === "timeout") {
      expect(expire).toBeTypeOf("function");
      expire!();
    }
    if (mode === "caller") await expect(login.outcome).rejects.toBe(reason);
    else
      await expect(login.outcome).rejects.toMatchObject({
        code: mode === "timeout" ? "login-timeout" : "lifecycle",
      });
    await expect(nativeFetch(url.searchParams.get("redirect_uri")!)).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  },
);

test.each(["discovery", "registration", "exchange", "validation"])(
  "cancellation interrupts %s HTTP and preserves committed state",
  async (phase) => {
    const previous = await store.updateOAuth(async () => credentials);
    const entered = deferred(),
      release = deferred();
    const { client, server } = await setup(async (request) => {
      if (
        (phase === "discovery" && request.path.startsWith("/.well-known")) ||
        (phase === "registration" && request.path === "/register") ||
        (phase === "exchange" && request.path === "/token") ||
        (phase === "validation" && request.message.method === "initialize")
      ) {
        entered.resolve();
        await release.promise;
      }
      return undefined;
    });
    const controller = new AbortController();
    const login = start(client, controller.signal);
    if (phase === "exchange" || phase === "validation")
      await nativeFetch(server.callbackURL(await login.authorization));
    await entered.promise;
    const reason = new Error("login-sentinel abort", { cause: "login-sentinel" });
    controller.abort(reason);
    await expect(login.outcome).rejects.toBe(reason);
    expect(await store.readOAuth()).toEqual(previous);
    release.resolve();
  },
);

test("shutdown interrupts login's commit lock wait without holding or changing credentials", async () => {
  const { client, server } = await setup();
  const entered = deferred(),
    release = deferred(),
    validated = deferred();
  const owner = store.updateOAuth(async () => {
    entered.resolve();
    await release.promise;
    return undefined;
  });
  await entered.promise;
  const close = Reflect.get(StreamableHTTPClientTransport.prototype, "close");
  vi.spyOn(StreamableHTTPClientTransport.prototype, "close").mockImplementation(
    async function (this: StreamableHTTPClientTransport) {
      await close.call(this);
      validated.resolve();
    },
  );
  const login = start(client);
  await nativeFetch(server.callbackURL(await login.authorization));
  await validated.promise;
  await client.close();
  await expect(login.outcome).rejects.toMatchObject({ code: "lifecycle" });
  release.resolve();
  await owner;
  expect((await store.readOAuth()).revision).toBe(0);
});

test.each(["write", "abort-write", "abort-after-rename"])(
  "%s respects the atomic commit point",
  async (mode) => {
    const previous = await store.updateOAuth(async () => credentials);
    const { client, server } = await setup();
    const controller = new AbortController();
    const reason = new Error("login-sentinel");
    const login = start(client, controller.signal);
    const url = server.callbackURL(await login.authorization);
    if (mode === "abort-after-rename") {
      const rename = fs.rename;
      vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
        await rename(...args);
        controller.abort(reason);
      });
    } else {
      const open = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const file = await open(...args);
        vi.spyOn(file, "writeFile").mockImplementation(async () => {
          if (mode === "abort-write") controller.abort(reason);
          throw new Error("login-sentinel write failure", { cause: "login-sentinel" });
        });
        return file;
      });
    }
    await nativeFetch(url);
    if (mode === "abort-after-rename") {
      await login.outcome;
      expect((await store.readOAuth()).revision).toBe(previous.revision + 1);
    } else {
      if (mode === "abort-write") await expect(login.outcome).rejects.toBe(reason);
      else await expect(login.outcome).rejects.toMatchObject({ code: "storage" });
      expect(await store.readOAuth()).toEqual(previous);
    }
    expect(
      (await fs.readdir(join(directory, "exa-web"))).some((name) => name.endsWith(".tmp")),
    ).toBe(false);
  },
);

test.each([
  "http://auth.example.test/authorize",
  "https://user:login-sentinel@auth.example.test/authorize",
])("rejects unsafe authorization URL %s before exposing it", async (authorizationEndpoint) => {
  const { client } = await setup((request) =>
    request.path === "/.well-known/oauth-authorization-server"
      ? {
          status: 200,
          json: {
            ...credentials.discovery.authorizationServerMetadata,
            authorization_endpoint: authorizationEndpoint,
          },
        }
      : undefined,
  );
  const show = vi.fn();
  await expect(client.login(show)).rejects.toMatchObject({ code: "authentication" });
  expect(show).not.toHaveBeenCalled();
  expect((await store.readOAuth()).revision).toBe(0);
});

test("two independent clients cannot overwrite a login committed during their browser wait", async () => {
  const { client, server } = await setup();
  const second = createExaMcpClient();
  clients.push(second);
  const firstLogin = start(client),
    secondLogin = start(second);
  const [firstUrl, secondUrl] = await Promise.all([
    firstLogin.authorization,
    secondLogin.authorization,
  ]);
  expect(firstUrl.searchParams.get("state")).not.toBe(secondUrl.searchParams.get("state"));
  await nativeFetch(server.callbackURL(firstUrl));
  await firstLogin.outcome;
  const committed = await store.readOAuth();
  await nativeFetch(server.callbackURL(secondUrl));
  await expect(secondLogin.outcome).rejects.toMatchObject({ code: "storage-conflict" });
  expect(await store.readOAuth()).toEqual(committed);
});

test("staged validation is private; successful re-login retires the old normal connection", async () => {
  await store.writeSettings({ version: 1, strategy: "authenticated-first" });
  await store.updateOAuth(async () => credentials);
  const entered = deferred(),
    release = deferred();
  const { client, server } = await setup(async (request) => {
    if (
      request.message.method === "initialize" &&
      request.headers.authorization === "Bearer login-sentinel-access"
    ) {
      entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  await client.search({ query: "old" }, undefined);
  const login = start(client);
  await nativeFetch(server.callbackURL(await login.authorization));
  await entered.promise;
  await client.fetch({ url: "https://example.com/old" }, undefined);
  expect(
    server.requests
      .filter((r) => r.message.method === "tools/call")
      .every((r) => r.headers.authorization === `Bearer ${credentials.tokens.access_token}`),
  ).toBe(true);
  release.resolve();
  await login.outcome;
  await client.search({ query: "new" }, undefined);
  const calls = server.requests.filter((r) => r.message.method === "tools/call");
  expect(calls.at(-1)!.headers.authorization).toBe("Bearer login-sentinel-access");
  expect(calls.at(-1)!.headers["mcp-session-id"]).not.toBe(calls[0].headers["mcp-session-id"]);
});

test.each(["matching", "different-issuer", "different-redirect"])(
  "saved registration reuse requires exact redirect and issuer: %s",
  async (mode) => {
    const { server } = await setup();
    const previous = {
      version: 1 as const,
      revision: 0,
      credentials: structuredClone(credentials),
    };
    previous.credentials.clientInformation.client_secret = "login-sentinel-client-secret";
    // Supply an existing registration for the actual ephemeral port selected by the OS.
    vi.spyOn(store, "readOAuth").mockResolvedValue(previous);
    const address = Reflect.get(Server.prototype, "address");
    vi.spyOn(Server.prototype, "address").mockImplementation(function (this: Server) {
      const bound = address.call(this);
      if (bound && typeof bound !== "string" && mode !== "different-redirect")
        previous.credentials.clientInformation = {
          ...previous.credentials.clientInformation,
          redirect_uris: [`http://127.0.0.1:${bound.port}/callback`],
        };
      return bound;
    });
    if (mode === "different-issuer")
      previous.credentials.clientInformation.issuer = "https://different.example";
    const control = new AbortController();
    let show!: (url: URL) => void;
    const authorization = new Promise<URL>((resolve) => {
      show = resolve;
    });
    const pending = loginOAuth(store, globalThis.fetch, show, control.signal);
    void pending.catch(() => {});
    const url = await authorization;
    expect(url.searchParams.get("client_id")).toBe(
      mode === "matching" ? "client-id" : "login-client-1",
    );
    expect(server.requests.filter((r) => r.path === "/register")).toHaveLength(
      mode === "matching" ? 0 : 1,
    );
    control.abort(new Error("cancel fixture"));
    await expect(pending).rejects.toThrow("cancel fixture");
  },
);
