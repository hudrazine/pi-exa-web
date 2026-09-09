import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createExaMcpClient } from "../src/exa-mcp-client.ts";
import { createStateStore } from "../src/state-store.ts";
import { credentials } from "./fixtures/oauth-state.ts";
import {
  deferred,
  forwardOAuth,
  oauthServer,
  type OAuthRequest,
  type OAuthReply,
} from "./fixtures/oauth-server.ts";
import { ExaError } from "../src/errors.ts";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

let directory: string;
let store: ReturnType<typeof createStateStore>;
const clients: ReturnType<typeof createExaMcpClient>[] = [];
const servers: Awaited<ReturnType<typeof oauthServer>>[] = [];
beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "pi-exa-oauth-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  store = createStateStore();
});
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await fs.rm(directory, { recursive: true, force: true });
});
async function setup(
  handler?: Parameters<typeof oauthServer>[0],
  apiKey: string | undefined = "key-sentinel",
) {
  const server = await oauthServer(handler);
  servers.push(server);
  vi.stubGlobal("fetch", forwardOAuth(server.origin));
  const client = createExaMcpClient({ apiKey });
  clients.push(client);
  return { server, client };
}
const isTool = (request: OAuthRequest) => request.message.method === "tools/call";
const invoke = (
  client: ReturnType<typeof createExaMcpClient>,
  operation: "search" | "fetch",
  signal?: AbortSignal,
) =>
  operation === "search"
    ? client.search({ query: "fixture" }, signal)
    : client.fetch({ url: "https://example.com" }, signal);
const unauthorized = {
  status: 401,
  headers: {
    "www-authenticate": 'Bearer resource_metadata="https://secret-sentinel.test/discovery"',
  },
};
async function authenticated() {
  await store.writeSettings({ version: 1, strategy: "authenticated-first" });
}

for (const operation of ["search", "fetch"] as const) {
  test.each(["valid", "expired", "no-expiry", "no-refresh", "login-required"])(
    `${operation}: authenticated-first resolves %s OAuth before API key`,
    async (mode) => {
      await authenticated();
      const saved = structuredClone(credentials);
      saved.expiresAt = mode === "expired" || mode === "no-refresh" ? 0 : Date.now() + 60_000;
      if (mode === "no-expiry") {
        delete saved.expiresAt;
        delete saved.tokens.expires_in;
      }
      if (mode === "no-refresh") delete saved.tokens.refresh_token;
      if (mode === "login-required") saved.loginRequired = true;
      await store.updateOAuth(async () => saved);
      const { server, client } = await setup();
      const auth = ["no-refresh", "login-required"].includes(mode) ? "api-key" : "oauth";
      await expect(invoke(client, operation)).resolves.toEqual({ text: "first\n\nsecond", auth });
      expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(
        mode === "expired" ? 1 : 0,
      );
      for (const request of server.requests) {
        if (request.path === "/mcp/oauth") {
          expect(request.headers["x-api-key"]).toBeUndefined();
          expect(request.headers.authorization).toBe(
            mode === "expired" ? "Bearer access-1" : `Bearer ${credentials.tokens.access_token}`,
          );
        } else if (request.path === "/mcp") {
          expect(request.headers["x-api-key"]).toBe("key-sentinel");
          expect(request.headers.authorization).toBeUndefined();
        } else expect(request.headers["x-api-key"]).toBeUndefined();
      }
    },
  );

  test(`${operation}: anonymous success does not read corrupt OAuth state`, async () => {
    await store.updateOAuth(async () => credentials);
    await fs.writeFile(join(directory, "exa-web", "oauth.json"), "secret-sentinel");
    const { client, server } = await setup();
    await expect(invoke(client, operation)).resolves.toMatchObject({ auth: "anonymous" });
    expect(server.requests.every((r) => r.path === "/mcp" && !r.headers["x-api-key"])).toBe(true);
  });

  test(`${operation}: anonymous limit falls back to OAuth; cooldown selects OAuth as primary`, async () => {
    await store.updateOAuth(async () => credentials);
    const { client, server } = await setup((r) =>
      isTool(r) && r.path === "/mcp"
        ? { status: 429, headers: { "retry-after": "30" } }
        : undefined,
    );
    await expect(invoke(client, operation)).resolves.toMatchObject({
      auth: "oauth",
      fallback: { from: "anonymous", to: "oauth", reason: "anonymous-rate-limit" },
    });
    await expect(invoke(client, operation)).resolves.toEqual({
      text: "first\n\nsecond",
      auth: "oauth",
    });
    expect(server.requests.filter((r) => isTool(r) && r.path === "/mcp")).toHaveLength(1);
  });

  test(`${operation}: 401 refresh ignores challenge URLs and replays only on OAuth`, async () => {
    await authenticated();
    const saved = structuredClone(credentials);
    delete saved.expiresAt;
    delete saved.tokens.expires_in;
    await store.updateOAuth(async () => saved);
    const { client, server } = await setup((r) =>
      isTool(r) && r.headers.authorization !== "Bearer access-1" ? unauthorized : undefined,
    );
    await expect(invoke(client, operation)).resolves.toEqual({
      text: "first\n\nsecond",
      auth: "oauth",
    });
    expect(server.requests.filter(isTool)).toHaveLength(2);
    expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
    expect((await store.readOAuth()).revision).toBe(2);
    expect(server.requests.every((r) => !r.headers["x-api-key"])).toBe(true);
  });

  test.each(["invalid_grant", "transient", "storage", "twice", "forbidden"])(
    `${operation}: post-send %s never switches credentials or falls back`,
    async (mode) => {
      await authenticated();
      await store.updateOAuth(async () => credentials);
      const { client, server } = await setup((r) => {
        if (isTool(r)) return mode === "forbidden" ? { status: 403 } : unauthorized;
        if (r.path === "/token") {
          if (mode === "invalid_grant")
            return {
              status: 400,
              json: { error: "invalid_grant", error_description: "secret-sentinel" },
            };
          if (mode === "transient") return { status: 503 };
        }
        return undefined;
      });
      if (mode === "storage")
        vi.spyOn(fs, "rename").mockRejectedValue(new Error("secret-sentinel"));
      const code =
        mode === "storage"
          ? "storage"
          : mode === "transient"
            ? "transport"
            : mode === "forbidden"
              ? "permission"
              : "authentication";
      await expect(invoke(client, operation)).rejects.toMatchObject({ code });
      expect(server.requests.filter(isTool)).toHaveLength(mode === "twice" ? 2 : 1);
      expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(
        mode === "forbidden" ? 0 : 1,
      );
      expect(server.requests.some((r) => r.path === "/mcp")).toBe(false);
    },
  );

  test.each(["402", "429", "leading", "other-tool", "later-block", "success", "raw-402"])(
    `${operation}: exact OAuth result classification: %s`,
    async (mode) => {
      await authenticated();
      await store.updateOAuth(async () => credentials);
      const tool = operation === "search" ? "web_search_exa" : "web_fetch_exa";
      const { client, server } = await setup((r) => {
        if (!isTool(r) || r.path !== "/mcp/oauth") return undefined;
        if (mode === "raw-402") return { status: 402 };
        const prefix = `${tool} error (${mode === "429" ? "429" : "402"}): secret-sentinel`;
        const text =
          mode === "leading"
            ? ` ${prefix}`
            : mode === "other-tool"
              ? `other error (402): secret-sentinel`
              : prefix;
        return {
          result: {
            isError: mode !== "success",
            content: [
              ...(mode === "later-block" ? [{ type: "text", text: "unclassified" }] : []),
              { type: "text", text },
            ],
          },
        };
      });
      if (mode === "402")
        await expect(invoke(client, operation)).resolves.toMatchObject({
          auth: "anonymous",
          fallback: { from: "oauth", to: "anonymous", reason: "credits-exhausted" },
        });
      else if (mode === "success")
        await expect(invoke(client, operation)).resolves.toMatchObject({
          auth: "oauth",
          text: expect.stringContaining("secret-sentinel"),
        });
      else
        await expect(invoke(client, operation)).rejects.toMatchObject({
          code:
            mode === "429" ? "authenticated-rate-limit" : mode === "raw-402" ? "transport" : "tool",
          retryAt: undefined,
        });
      expect(server.requests.filter(isTool)).toHaveLength(mode === "402" ? 2 : 1);
    },
  );
}

test.each([true, false])(
  "pre-send refresh failure selects key or anonymous (key=%s)",
  async (hasKey) => {
    await authenticated();
    await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
    const { client, server } = await setup(
      (r) => (r.path === "/token" ? { status: 503 } : undefined),
      hasKey ? "key-sentinel" : "",
    );
    await expect(invoke(client, "search")).resolves.toEqual({
      text: "first\n\nsecond",
      auth: hasKey ? "api-key" : "anonymous",
    });
    expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
    expect(server.requests.some((r) => r.path === "/mcp/oauth")).toBe(false);
  },
);

test("rotation then failed rename stops before any tool or alternate route", async () => {
  await authenticated();
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const { client, server } = await setup();
  vi.spyOn(fs, "rename").mockRejectedValue(new Error("secret-sentinel"));
  await expect(invoke(client, "search")).rejects.toMatchObject({ code: "storage" });
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.path).toBe("/token");
});

test("revision replacement retires the connection without interrupting an existing tool", async () => {
  await authenticated();
  await store.updateOAuth(async () => credentials);
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  const { client, server } = await setup(async (r) => {
    if (isTool(r) && ++calls === 1) {
      entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  const first = invoke(client, "search");
  await entered.promise;
  await store.updateOAuth(async () => ({
    ...credentials,
    tokens: { ...credentials.tokens, access_token: "replacement" },
  }));
  await expect(invoke(client, "fetch")).resolves.toMatchObject({ auth: "oauth" });
  release.resolve();
  await expect(first).resolves.toMatchObject({ auth: "oauth" });
  const callsSent = server.requests.filter(isTool);
  expect(callsSent.map((r) => r.headers.authorization)).toEqual([
    `Bearer ${credentials.tokens.access_token}`,
    "Bearer replacement",
  ]);
  expect(callsSent[0]?.headers["mcp-session-id"]).not.toBe(callsSent[1]?.headers["mcp-session-id"]);
});

test("logout clears credentials and cached OAuth but retains strategy and startup API key", async () => {
  await authenticated();
  await store.updateOAuth(async () => credentials);
  const { client, server } = await setup();
  await expect(invoke(client, "search")).resolves.toMatchObject({ auth: "oauth" });
  await client.logout();
  expect(await store.readOAuth()).toEqual({ version: 1, revision: 2, credentials: null });
  expect(await client.getStrategy()).toBe("authenticated-first");
  await expect(invoke(client, "fetch")).resolves.toMatchObject({ auth: "api-key" });
  expect(server.requests.some((r) => r.path === "/token")).toBe(false);
  await client.close();
  await expect(client.logout()).rejects.toMatchObject({ code: "lifecycle" });
});

test("session recovery cannot reset OAuth 401 recovery or permit an API key third route", async () => {
  await authenticated();
  await store.updateOAuth(async () => credentials);
  let calls = 0;
  const { client, server } = await setup((r) => {
    if (!isTool(r)) return undefined;
    calls++;
    return calls === 2 ? { status: 404 } : unauthorized;
  });
  await expect(invoke(client, "search")).rejects.toMatchObject({ code: "authentication" });
  expect(server.requests.filter(isTool)).toHaveLength(3);
  expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
});

test("a reconnect handshake cannot start another refresh after tool 401 recovery", async () => {
  await authenticated();
  await store.updateOAuth(async () => credentials);
  let initializes = 0,
    calls = 0;
  const { client, server } = await setup((request) => {
    if (request.message.method === "initialize" && ++initializes === 2) return unauthorized;
    if (isTool(request)) return ++calls === 1 ? unauthorized : { status: 404 };
    return undefined;
  });
  await expect(invoke(client, "search")).rejects.toMatchObject({ code: "authentication" });
  expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
  expect(server.requests.filter(isTool)).toHaveLength(2);
});

test("shared OAuth initialization survives cancellation of one waiter", async () => {
  await authenticated();
  await store.updateOAuth(async () => credentials);
  const entered = deferred();
  const release = deferred();
  const { client, server } = await setup(async (r) => {
    if (r.message.method === "initialize") {
      entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  const controller = new AbortController();
  const first = invoke(client, "search", controller.signal);
  const second = invoke(client, "fetch");
  await entered.promise;
  const reason = new Error("secret-sentinel");
  controller.abort(reason);
  await expect(first).rejects.toBe(reason);
  release.resolve();
  await expect(second).resolves.toMatchObject({ auth: "oauth" });
  expect(server.requests.filter((r) => r.message.method === "initialize")).toHaveLength(1);
});

test("shutdown interrupts refresh and waits for the lock to be released", async () => {
  await authenticated();
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const entered = deferred();
  const release = deferred();
  const { client } = await setup(async (r) => {
    if (r.path === "/token") {
      entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  const pending = expect(invoke(client, "search")).rejects.toMatchObject({ code: "lifecycle" });
  await entered.promise;
  await client.close();
  await pending;
  await store.updateOAuth(async () => null);
  release.resolve();
});

test("three initialized routes terminate in parallel within one grace period without refresh", async () => {
  const deletes = deferred(),
    release = deferred();
  let deleting = 0;
  const { client, server } = await setup(async (request) => {
    if (request.method === "DELETE") {
      if (++deleting === 3) deletes.resolve();
      await release.promise;
      return unauthorized;
    }
    return undefined;
  });
  await invoke(client, "search");
  await authenticated();
  await invoke(client, "search");
  await store.updateOAuth(async () => credentials);
  await invoke(client, "search");
  const before = performance.now();
  const closing = client.close();
  expect(client.close()).toBe(closing);
  await deletes.promise;
  await closing;
  expect(performance.now() - before).toBeLessThan(1_800);
  expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(0);
  release.resolve();
}, 3_000);

test("logout while initialization is held prevents an old completion from sending a tool", async () => {
  await authenticated();
  await store.updateOAuth(async () => credentials);
  const entered = deferred(),
    release = deferred();
  const { client, server } = await setup(async (request) => {
    if (request.path === "/mcp/oauth" && request.message.method === "initialize") {
      entered.resolve();
      await release.promise;
    }
    return undefined;
  });
  const pending = invoke(client, "search");
  await entered.promise;
  await client.logout();
  release.resolve();
  await expect(pending).resolves.toMatchObject({ auth: "api-key" });
  expect(server.requests.filter(isTool).map((r) => r.path)).toEqual(["/mcp"]);
  await expect(invoke(client, "fetch")).resolves.toMatchObject({ auth: "api-key" });
});

test.each(["search", "fetch"] as const)(
  "logout retires late OAuth initialization after its sole %s waiter cancels",
  async (operation) => {
    await authenticated();
    await store.updateOAuth(async () => credentials);
    const entered = deferred(),
      release = deferred();
    const closed = vi.spyOn(StreamableHTTPClientTransport.prototype, "close");
    const { client, server } = await setup(async (request) => {
      if (request.path === "/mcp/oauth" && request.message.method === "initialize") {
        entered.resolve();
        await release.promise;
      }
      return undefined;
    });
    const controller = new AbortController();
    const pending = invoke(client, operation, controller.signal);
    await entered.promise;
    const reason = new Error("cancel sole waiter");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await client.logout();
    expect(await store.readOAuth()).toEqual({ version: 1, revision: 2, credentials: null });
    release.resolve();
    // No next OAuth caller remains to perform revision validation and cleanup.
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    expect(server.requests.filter(isTool)).toEqual([]);
    await expect(invoke(client, operation)).resolves.toMatchObject({ auth: "api-key" });
    await client.close();
    expect(server.requests.filter((r) => r.method === "DELETE" && r.path === "/mcp/oauth")).toEqual(
      [],
    );
  },
);

test.each(["authentication", "network", "permission"])(
  "OAuth initialization %s has the specified alternate boundary",
  async (mode) => {
    await authenticated();
    const saved = structuredClone(credentials);
    delete saved.tokens.refresh_token;
    await store.updateOAuth(async () => saved);
    const { client, server } = await setup((request) => {
      if (request.path === "/mcp/oauth" && request.message.method === "initialize")
        return mode === "authentication"
          ? unauthorized
          : mode === "permission"
            ? { status: 403 }
            : { disconnect: true };
      return undefined;
    });
    if (mode === "authentication")
      await expect(invoke(client, "search")).resolves.toMatchObject({ auth: "api-key" });
    else
      await expect(invoke(client, "search")).rejects.toMatchObject({
        code: mode === "permission" ? "permission" : "transport",
      });
    expect(server.requests.filter(isTool)).toHaveLength(mode === "authentication" ? 1 : 0);
  },
);

test("OAuth rejection before send followed by key 402 reports the actual fallback origin", async () => {
  await authenticated();
  const saved = structuredClone(credentials);
  delete saved.tokens.refresh_token;
  await store.updateOAuth(async () => saved);
  const { client } = await setup((request) => {
    if (request.path === "/mcp/oauth" && request.message.method === "initialize")
      return unauthorized;
    if (isTool(request) && request.headers["x-api-key"])
      return {
        result: {
          isError: true,
          content: [{ type: "text", text: "web_search_exa error (402): private" }],
        },
      };
    return undefined;
  });
  await expect(invoke(client, "search")).resolves.toMatchObject({
    auth: "anonymous",
    fallback: { from: "api-key", to: "anonymous", reason: "credits-exhausted" },
  });
});

test.each(["anonymous-first", "authenticated-first"] as const)(
  "%s cannot loop through a third route after 402/429",
  async (strategy) => {
    await store.writeSettings({ version: 1, strategy });
    await store.updateOAuth(async () => credentials);
    let anonymousCalls = 0;
    const { client, server } = await setup((request) => {
      if (!isTool(request)) return undefined;
      if (request.path === "/mcp/oauth")
        return {
          result: {
            isError: true,
            content: [{ type: "text", text: "web_search_exa error (402): private" }],
          },
        };
      anonymousCalls++;
      return { status: 429, headers: { "retry-after": anonymousCalls === 1 ? "0" : "30" } };
    });
    await expect(invoke(client, "search")).rejects.toMatchObject({
      code: strategy === "anonymous-first" ? "credits-exhausted" : "anonymous-rate-limit",
    });
    expect(server.requests.filter(isTool)).toHaveLength(3);
    expect(server.requests.some((r) => r.headers["x-api-key"])).toBe(false);
  },
);

test("immediately expired refresh results do not loop or get sent", async () => {
  await authenticated();
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const { client, server } = await setup((request) =>
    request.path === "/token"
      ? { json: { access_token: "new", token_type: "Bearer", expires_in: 0 } }
      : undefined,
  );
  await expect(invoke(client, "search")).resolves.toMatchObject({ auth: "api-key" });
  expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(1);
  expect(server.requests.some((r) => r.path === "/mcp/oauth")).toBe(false);
});

test("shutdown aborts refresh and logout lock waiters without reviving credentials", async () => {
  await authenticated();
  await store.updateOAuth(async () => ({ ...credentials, expiresAt: 0 }));
  const entered = deferred(),
    release = deferred();
  const owner = store.updateOAuth(async () => {
    entered.resolve();
    await release.promise;
    return undefined;
  });
  await entered.promise;
  const { client, server } = await setup();
  const calling = expect(invoke(client, "search")).rejects.toMatchObject({ code: "lifecycle" });
  const logout = expect(client.logout()).rejects.toMatchObject({ code: "lifecycle" });
  await client.close();
  await Promise.all([calling, logout]);
  expect(server.requests).toEqual([]);
  release.resolve();
  await owner;
  expect((await store.readOAuth()).revision).toBe(1);
});

test.each([429, 503, "network", "scope"] as const)(
  "OAuth %s failures keep only final evidence and never select the key",
  async (failure) => {
    await store.updateOAuth(async () => credentials);
    const { client, server } = await setup((request): OAuthReply | undefined => {
      if (!isTool(request)) return undefined;
      if (request.path === "/mcp") return { status: 429, headers: { "retry-after": "30" } };
      if (failure === "network") return { disconnect: true };
      if (failure === "scope")
        return {
          status: 403,
          headers: { "www-authenticate": 'Bearer error="insufficient_scope", scope="secret"' },
        };
      return { status: failure, headers: { "retry-after": "5" } };
    });
    const before = Date.now();
    const error = await invoke(client, "search").catch((value: unknown) => value);
    expect(error).toMatchObject({
      code:
        failure === 429
          ? "authenticated-rate-limit"
          : failure === 503
            ? "server"
            : failure === "scope"
              ? "permission"
              : "transport",
    });
    if (failure === 429) {
      expect(error).toBeInstanceOf(ExaError);
      if (!(error instanceof ExaError)) throw new Error("Expected safe error");
      expect(error.retryAt).toBeGreaterThanOrEqual(before + 5_000);
      expect(error.retryAt).toBeLessThanOrEqual(Date.now() + 5_000);
    } else expect(error).toMatchObject({ retryAt: undefined });
    expect(server.requests.filter(isTool)).toHaveLength(2);
    expect(server.requests.filter((r) => r.path === "/token")).toHaveLength(0);
    expect(server.requests.some((r) => r.headers["x-api-key"])).toBe(false);
  },
);
