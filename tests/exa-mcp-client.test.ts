import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { inspect } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve as resolvePath, join } from "node:path";
import {
  discoverAndLoadExtensions,
  SessionManager,
  initTheme,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import packageJson from "../package.json" with { type: "json" };
import { createExaMcpClient } from "../src/exa-mcp-client.ts";
import { ExaError } from "../src/errors.ts";

interface CapturedRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
  message?: Record<string, unknown>;
  aborted?: boolean;
}

interface Fixture {
  endpoint: URL;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

type ToolReply =
  | { result?: unknown; error?: unknown }
  | { disconnect: true }
  | { status: number; headers?: Record<string, string>; body?: string };

interface FixtureOptions {
  deleteGate?: Promise<void>;
  initializeGate?: Promise<void> | ((request: CapturedRequest) => Promise<void>);
  initializeFailures?: number;
  initializeFailureRoute?: "api-key";
  initializeStatus?: number;
  sessionless?: boolean;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("Exa MCP client", () => {
  test("connects lazily once and maps concurrent search and fetch calls", async () => {
    const fixture = await createFixture((request) => {
      if (request.message?.method !== "tools/call") {
        return undefined;
      }

      const params = getRecord(request.message, "params");
      const toolArguments = getRecord(params, "arguments");
      if (getString(params, "name") === "web_search_exa") {
        expect(toolArguments).toEqual({ query: "Pi extensions" });
        return {
          result: {
            content: [
              { type: "text", text: "first" },
              { type: "image", data: "ignored", mimeType: "image/png" },
              { type: "text", text: "second" },
            ],
          },
        };
      }

      expect(params).toEqual({
        name: "web_fetch_exa",
        arguments: { urls: ["https://pi.dev"], maxCharacters: 4_000 },
      });
      return { result: { content: [{ type: "text", text: "page" }] } };
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint });

    expect(fixture.requests).toHaveLength(0);
    const [search, fetch] = await Promise.all([
      client.search({ query: "Pi extensions" }, undefined),
      client.fetch({ url: "https://pi.dev", maxCharacters: 4_000 }, undefined),
    ]);

    expect(search).toEqual({ text: "first\n\nsecond", auth: "anonymous" });
    expect(fetch).toEqual({ text: "page", auth: "anonymous" });
    expect(countRequests(fixture, "server/discover")).toBe(1);
    expect(countRequests(fixture, "initialize")).toBe(1);
    expect(countRequests(fixture, "tools/call")).toBe(2);
    const initialize = fixture.requests.find((request) => request.message?.method === "initialize");
    expect(getRecord(getRecord(initialize?.message, "params"), "clientInfo")).toEqual({
      name: "pi-exa-web",
      version: packageJson.version,
    });
  });

  test("replaces MCP tool, protocol, and non-text errors with safe package errors", async () => {
    const fixture = await createFixture((request) => {
      const query = getToolArgument(request, "query");
      if (query === "tool error") {
        return {
          result: {
            isError: true,
            content: [{ type: "text", text: "safe Exa error" }],
          },
        };
      }
      if (query === "protocol error") {
        return { error: { code: -32_000, message: "fixture protocol error" } };
      }
      return {
        result: { content: [{ type: "image", data: "eA==", mimeType: "image/png" }] },
      };
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint });

    await expect(client.search({ query: "tool error" }, undefined)).rejects.toThrow(
      "Exa returned an unsuccessful or unexpected tool response.",
    );
    await expect(client.search({ query: "no text" }, undefined)).rejects.toThrow(
      "Exa returned an unsuccessful or unexpected tool response.",
    );
    await expect(client.search({ query: "protocol error" }, undefined)).rejects.toThrow(
      "Exa returned an unsuccessful or unexpected tool response.",
    );
  });

  test("cancels only one connection waiter while shared initialization continues", async () => {
    const initializeGate = deferred<void>();
    const fixture = await createFixture(
      () => ({ result: { content: [{ type: "text", text: "ok" }] } }),
      { initializeGate: initializeGate.promise },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    const controller = new AbortController();
    const canceled = client.search({ query: "canceled" }, controller.signal);
    const survivor = client.search({ query: "survivor" }, undefined);
    await waitUntil(() => countRequests(fixture, "initialize") === 1);

    const reason = new Error("caller canceled");
    controller.abort(reason);
    await expect(canceled).rejects.toBe(reason);
    initializeGate.resolve();

    await expect(survivor).resolves.toEqual({ text: "ok", auth: "anonymous" });
    expect(countRequests(fixture, "initialize")).toBe(1);
    expect(countRequests(fixture, "tools/call")).toBe(1);
  });

  test("does not connect for a caller that is already canceled", async () => {
    const fixture = await createFixture(() => ({
      result: { content: [{ type: "text", text: "unused" }] },
    }));
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    const controller = new AbortController();
    const reason = new Error("already canceled");
    controller.abort(reason);

    await expect(client.search({ query: "unused" }, controller.signal)).rejects.toBe(reason);
    expect(fixture.requests).toHaveLength(0);
  });

  test("discards a failed initialization so a later call can reconnect", async () => {
    const fixture = await createFixture(
      () => ({ result: { content: [{ type: "text", text: "recovered" }] } }),
      { initializeFailures: 1 },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint });

    await expect(client.search({ query: "first" }, undefined)).rejects.toThrow();
    await expect(client.search({ query: "second" }, undefined)).resolves.toEqual({
      text: "recovered",
      auth: "anonymous",
    });
    expect(countRequests(fixture, "server/discover")).toBe(2);
    expect(countRequests(fixture, "initialize")).toBe(2);
    expect(countRequests(fixture, "tools/call")).toBe(1);
  });

  test("reexecutes the intent on the key connection while preserving concurrent auth routes", async () => {
    const fixture = await createFixture((request) => {
      const params = getRecord(request.message, "params");
      const toolArguments = getRecord(params, "arguments");
      if (getString(params, "name") === "web_search_exa") {
        expect(toolArguments).toEqual({ query: "needs fallback", numResults: 3 });
      } else {
        expect(toolArguments).toEqual({ urls: ["https://pi.dev"] });
      }
      if (
        getString(toolArguments, "query") === "needs fallback" &&
        request.headers["x-api-key"] === undefined
      ) {
        return { status: 429, headers: { "retry-after": "10" } };
      }
      return {
        result: {
          content: [
            {
              type: "text",
              text:
                getString(params, "name") === "web_search_exa"
                  ? "fallback result"
                  : "anonymous page",
            },
          ],
        },
      };
    });
    const client = createExaMcpClient({
      endpoint: fixture.endpoint,
      apiKey: "  test-secret-key  ",
    });

    const [search, fetch] = await Promise.all([
      client.search({ query: "needs fallback", numResults: 3 }, undefined),
      client.fetch({ url: "https://pi.dev" }, undefined),
    ]);
    await client.close();

    expect(search).toEqual({ text: "fallback result", auth: "api-key" });
    expect(fetch).toEqual({ text: "anonymous page", auth: "anonymous" });
    const searchRequests = fixture.requests.filter(
      (request) =>
        request.message?.method === "tools/call" &&
        getString(getRecord(request.message, "params"), "name") === "web_search_exa",
    );
    expect(searchRequests).toHaveLength(2);
    expect(searchRequests[0]?.message?.params).toEqual(searchRequests[1]?.message?.params);
    expect(searchRequests[0]?.headers["x-api-key"]).toBeUndefined();
    expect(searchRequests[1]?.headers["x-api-key"]).toBe("test-secret-key");
    expect(searchRequests[0]?.headers["mcp-session-id"]).not.toBe(
      searchRequests[1]?.headers["mcp-session-id"],
    );
    const initializes = fixture.requests.filter(
      (request) => request.message?.method === "initialize",
    );
    expect(initializes.map((request) => request.headers["x-api-key"])).toEqual([
      undefined,
      "test-secret-key",
    ]);
  });

  test("aborts one in-flight tool request and reuses the shared connection", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const fixture = await createFixture(async (request) => {
      const query = getToolArgument(request, "query");
      if (query === "hold") {
        started.resolve();
        await release.promise;
      }
      return { result: { content: [{ type: "text", text: query }] } };
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    const controller = new AbortController();
    const pending = client.search({ query: "hold" }, controller.signal);
    await started.promise;

    const reason = new Error("stop tool call");
    controller.abort(reason);
    await expect(pending).rejects.toThrow("stop tool call");
    await waitUntil(() =>
      fixture.requests.some(
        (request) => getToolArgument(request, "query") === "hold" && request.aborted === true,
      ),
    );
    await expect(client.search({ query: "next" }, undefined)).resolves.toEqual({
      text: "next",
      auth: "anonymous",
    });
    release.resolve();
    expect(countRequests(fixture, "initialize")).toBe(1);
  });

  test("closes an in-flight session once and stays permanently closed", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const deleteGate = deferred<void>();
    const fixture = await createFixture(
      async () => {
        started.resolve();
        await release.promise;
        return { result: { content: [{ type: "text", text: "late" }] } };
      },
      { deleteGate: deleteGate.promise },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    const pending = client.search({ query: "hold" }, undefined);
    await started.promise;
    const beforeShutdown = fixture.requests.length;

    const failed = expect(pending).rejects.toThrow();
    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await firstClose;
    await failed;
    expect(fixture.requests.filter((request) => request.method === "DELETE")).toHaveLength(1);
    expect(fixture.requests.length).toBeGreaterThan(beforeShutdown);
    const afterShutdown = fixture.requests.length;

    await expect(client.search({ query: "after" }, undefined)).rejects.toThrow(
      "MCP client is closed",
    );
    expect(fixture.requests).toHaveLength(afterShutdown);
    release.resolve();
  }, 2_500);

  test("interrupts a shared handshake when shutdown starts", async () => {
    const initializeGate = deferred<void>();
    const fixture = await createFixture(
      () => ({ result: { content: [{ type: "text", text: "unused" }] } }),
      { initializeGate: initializeGate.promise },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    const pending = client.search({ query: "unused" }, undefined);
    await waitUntil(() => countRequests(fixture, "initialize") === 1);

    await expect(client.close()).resolves.toBeUndefined();
    await expect(pending).rejects.toThrow();
    expect(countRequests(fixture, "tools/call")).toBe(0);
    initializeGate.resolve();
  });
});

const operations = ["search", "fetch"] as const;
function invoke(
  client: ReturnType<typeof createExaMcpClient>,
  operation: (typeof operations)[number],
  signal?: AbortSignal,
) {
  return operation === "search"
    ? client.search({ query: "fixture" }, signal)
    : client.fetch({ url: "https://example.com" }, signal);
}
const success: ToolReply = { result: { content: [{ type: "text", text: "ok" }] } };
const sentinel = "PRIVATE_SENTINEL_836192";

describe.each(operations)("%s route and failure boundaries", (operation) => {
  test("preserves successful text independently of failure secrecy", async () => {
    const text = `https://user:${sentinel}@example.com\r\n\u001b[31mcontent\u001b[0m`;
    const fixture = await createFixture(() => ({
      result: {
        content: [
          { type: "text", text },
          { type: "text", text: "second" },
        ],
      },
    }));
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    expect(await invoke(client, operation)).toEqual({
      text: text + "\n\nsecond",
      auth: "anonymous",
    });
    await client.close();
  });
  test.each([
    [401, "authentication"],
    [403, "permission"],
    [402, "transport"],
    [500, "server"],
    [503, "server"],
  ])("does not replay HTTP %i on either route", async (status, code) => {
    for (const authenticated of [false, true]) {
      const fixture = await createFixture((request): ToolReply => {
        if (authenticated && request.headers["x-api-key"] === undefined)
          return { status: 429, headers: { "retry-after": "30" } };
        return {
          status,
          headers: { "x-private": sentinel },
          body: `https://user:${sentinel}@example.com?token=${sentinel}`,
        };
      });
      const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
      const error = await invoke(client, operation).catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ExaError);
      expect(error).toMatchObject({ code });
      expect(error).not.toHaveProperty("cause");
      expect(inspect(error, { depth: 10 })).not.toContain(sentinel);
      expect(error).toMatchObject({ retryAt: undefined });
      expect(countRequests(fixture, "tools/call")).toBe(authenticated ? 2 : 1);
      await client.close();
    }
  });

  test("retains only the authenticated 429 deadline", async () => {
    const retryAt = Date.parse("2030-01-01T00:00:00Z");
    const fixture = await createFixture((request) => ({
      status: 429,
      headers: {
        "retry-after":
          request.headers["x-api-key"] === undefined ? "30" : "Tue, 01 Jan 2030 00:00:00 GMT",
      },
      body: sentinel,
    }));
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    await expect(invoke(client, operation)).rejects.toMatchObject({
      code: "authenticated-rate-limit",
      retryAt,
    });
    expect(countRequests(fixture, "tools/call")).toBe(2);
    await client.close();
  });

  test.each([true, false])(
    "recovers a session 404 once (authenticated=%s)",
    async (authenticated) => {
      let rejected = false;
      const fixture = await createFixture((request) => {
        if (authenticated && request.headers["x-api-key"] === undefined)
          return { status: 429, headers: { "retry-after": "30" } };
        if (!rejected) {
          rejected = true;
          return { status: 404, body: sentinel };
        }
        return success;
      });
      const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
      expect(await invoke(client, operation)).toEqual({
        text: "ok",
        auth: authenticated ? "api-key" : "anonymous",
      });
      const calls = fixture.requests.filter((request) => request.message?.method === "tools/call");
      expect(calls).toHaveLength(authenticated ? 3 : 2);
      expect(calls.at(-1)?.headers["mcp-session-id"]).not.toBe(
        calls.at(-2)?.headers["mcp-session-id"],
      );
      expect(calls.at(-1)?.message?.params).toEqual(calls.at(-2)?.message?.params);
      expect(countRequests(fixture, "initialize")).toBe(authenticated ? 3 : 2);
      await client.close();
    },
  );

  test.each([true, false])("bounds repeated 404s (sessionless=%s)", async (sessionless) => {
    const fixture = await createFixture(() => ({ status: 404, body: sentinel }), { sessionless });
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    await expect(invoke(client, operation)).rejects.toMatchObject({ code: "transport" });
    expect(countRequests(fixture, "tools/call")).toBe(sessionless ? 1 : 2);
    expect(fixture.requests.every((request) => request.headers["x-api-key"] === undefined)).toBe(
      true,
    );
    await client.close();
  });

  test("does not reset probe or session recovery budgets when reconnecting", async () => {
    let anonymous = 0;
    const fixture = await createFixture((request) => {
      if (request.headers["x-api-key"] !== undefined) return success;
      anonymous++;
      if (anonymous === 1) return { status: 404 };
      return { status: 429, headers: { "retry-after": "0" } };
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    expect(await invoke(client, operation)).toEqual({ text: "ok", auth: "api-key" });
    expect(anonymous).toBe(3);
    expect(countRequests(fixture, "tools/call")).toBe(4);
    await client.close();
  });

  test("a 404 after the probe cannot grant a second session recovery", async () => {
    let count = 0;
    const fixture = await createFixture(() => {
      count++;
      return count === 2 ? { status: 429, headers: { "retry-after": "0" } } : { status: 404 };
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    await expect(invoke(client, operation)).rejects.toMatchObject({ code: "transport" });
    expect(count).toBe(3);
    await client.close();
  });

  test.each([
    {
      result: {
        isError: true,
        content: [{ type: "text", text: `web_search_exa error (402): ${sentinel}` }],
      },
    },
    {
      result: {
        isError: true,
        content: [{ type: "text", text: `web_fetch_exa error (429): ${sentinel}` }],
      },
    },
    {
      error: {
        code: -32000,
        message: sentinel,
        data: { cause: { headers: { authorization: sentinel } } },
      },
    },
    { result: { content: [{ type: "image", data: sentinel, mimeType: "image/png" }] } },
  ])("sanitizes MCP failures without classifying text or replaying: %j", async (reply) => {
    const fixture = await createFixture((request) =>
      request.headers["x-api-key"] === undefined ? { status: 429 } : reply,
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    const error = await invoke(client, operation).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "tool" });
    expect(inspect(error, { depth: 10 })).not.toContain(sentinel);
    expect(countRequests(fixture, "tools/call")).toBe(2);
    await client.close();
  });

  test("does not replay a dropped tool response", async () => {
    const fixture = await createFixture(() => ({ disconnect: true }));
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    await expect(invoke(client, operation)).rejects.toMatchObject({ code: "transport" });
    expect(countRequests(fixture, "tools/call")).toBe(1);
    await client.close();
  });

  test("does not treat initialization 429 as a tool rate limit", async () => {
    const fixture = await createFixture(() => success, { initializeStatus: 429 });
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    await expect(invoke(client, operation)).rejects.toMatchObject({ code: "transport" });
    expect(countRequests(fixture, "tools/call")).toBe(0);
    expect(countRequests(fixture, "initialize")).toBe(1);
    expect(fixture.requests.every((request) => request.headers["x-api-key"] === undefined)).toBe(
      true,
    );
    await client.close();
  });
});

describe("concurrent route lifecycle", () => {
  test("shares a failed key initialization and reconnects on the next call", async () => {
    const fixture = await createFixture(
      (request) =>
        request.headers["x-api-key"] === undefined
          ? { status: 429, headers: { "retry-after": "30" } }
          : success,
      { initializeFailures: 1, initializeFailureRoute: "api-key" },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    const failures = await Promise.all(
      operations.map((operation) => invoke(client, operation).catch((error: unknown) => error)),
    );
    expect(failures).toMatchObject([{ code: "server" }, { code: "server" }]);
    expect(countRequests(fixture, "initialize")).toBe(2);
    expect(await invoke(client, "fetch")).toEqual({ text: "ok", auth: "api-key" });
    expect(countRequests(fixture, "initialize")).toBe(3);
    await client.close();
  });
  test("deduplicates key initialization and cancels only its individual waiter", async () => {
    const gate = deferred<void>();
    const fixture = await createFixture(
      (request) => (request.headers["x-api-key"] === undefined ? { status: 429 } : success),
      {
        initializeGate: (request) =>
          request.headers["x-api-key"] === undefined ? Promise.resolve() : gate.promise,
      },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    const controller = new AbortController();
    const canceled = invoke(client, "search", controller.signal);
    const survivor = invoke(client, "fetch");
    await waitUntil(() => countRequests(fixture, "initialize") === 2);
    const reason = { private: sentinel };
    controller.abort(reason);
    await expect(canceled).rejects.toBe(reason);
    gate.resolve();
    expect(await survivor).toEqual({ text: "ok", auth: "api-key" });
    expect(countRequests(fixture, "initialize")).toBe(2);
    await client.close();
  });

  test("concurrent session failures share a fresh connection without discarding it", async () => {
    const bothStarted = deferred<void>();
    let rejected = 0;
    const fixture = await createFixture(async (request) => {
      if (request.headers["mcp-session-id"] === "test-session-1") {
        if (++rejected === 2) bothStarted.resolve();
        await bothStarted.promise;
        return { status: 404 };
      }
      return success;
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint });
    expect(await Promise.all([invoke(client, "search"), invoke(client, "fetch")])).toEqual([
      { text: "ok", auth: "anonymous" },
      { text: "ok", auth: "anonymous" },
    ]);
    expect(countRequests(fixture, "initialize")).toBe(2);
    expect(countRequests(fixture, "tools/call")).toBe(4);
    await client.close();
  });

  test("isolates concurrent HTTP failure metadata on the same connection", async () => {
    const gate = deferred<void>();
    const fixture = await createFixture(async (request) => {
      if (getToolArgument(request, "query") !== undefined) {
        await gate.promise;
        return { status: 401, body: sentinel };
      }
      gate.resolve();
      return { status: 503, body: sentinel };
    });
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    const errors = await Promise.all(
      operations.map((operation) => invoke(client, operation).catch((error: unknown) => error)),
    );
    expect(errors).toMatchObject([{ code: "authentication" }, { code: "server" }]);
    expect(countRequests(fixture, "tools/call")).toBe(2);
    await client.close();
  });

  test("shutdown interrupts a probe delay before any retry or fallback", async () => {
    const fixture = await createFixture(() => ({ status: 429, headers: { "retry-after": "2" } }));
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    const pending = expect(invoke(client, "search")).rejects.toMatchObject({ code: "lifecycle" });
    await waitUntil(() => countRequests(fixture, "tools/call") === 1);
    await client.close();
    await pending;
    expect(countRequests(fixture, "tools/call")).toBe(1);
  });

  test("terminates both sessions in parallel under one grace period", async () => {
    const gate = deferred<void>();
    const fixture = await createFixture(
      (request) => (request.headers["x-api-key"] === undefined ? { status: 429 } : success),
      { deleteGate: gate.promise },
    );
    const client = createExaMcpClient({ endpoint: fixture.endpoint, apiKey: sentinel });
    await invoke(client, "search");
    const start = performance.now();
    const closing = client.close();
    expect(client.close()).toBe(closing);
    await waitUntil(() => fixture.requests.filter((r) => r.method === "DELETE").length === 2);
    await closing;
    expect(performance.now() - start).toBeLessThan(1_800);
    const deletes = fixture.requests.filter((r) => r.method === "DELETE");
    expect(deletes.map((r) => r.headers["x-api-key"])).toEqual(
      expect.arrayContaining([undefined, sentinel]),
    );
    await waitUntil(() => deletes.every((r) => r.aborted));
    gate.resolve();
    await expect(invoke(client, "fetch")).rejects.toMatchObject({ code: "lifecycle" });
  }, 3_000);
});

test("real Pi loader keeps failures secret through rendering and persisted conversation records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-exa-errors-"));
  const logSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  let mode = "http";
  const fixture = await createFixture((request): ToolReply => {
    if (request.headers["x-api-key"] === undefined)
      return { status: 429, headers: { "retry-after": "30" } };
    expect(request.headers["x-api-key"]).toBe(sentinel);
    if (mode === "http")
      return {
        status: 500,
        headers: { "x-private": sentinel },
        body: `https://user:${sentinel}@example.com?token=${sentinel}`,
      };
    if (mode === "tool")
      return {
        result: {
          isError: true,
          content: [
            { type: "text", text: `web_search_exa error (402): ${sentinel}` },
            { type: "text", text: `web_fetch_exa error (429): ${sentinel}` },
          ],
        },
      };
    if (mode === "protocol")
      return {
        error: {
          code: -32000,
          message: sentinel,
          data: { cause: { headers: { authorization: sentinel } } },
        },
      };
    if (mode === "non-text")
      return {
        result: {
          content: [
            {
              type: "image",
              data: Buffer.from(sentinel).toString("base64"),
              mimeType: "image/png",
            },
          ],
        },
      };
    return success;
  });
  const nativeFetch = globalThis.fetch;
  const fetchSpy = vi.fn<typeof fetch>(async (input, init) => {
    expect(input instanceof Request ? input.url : input.toString()).toBe(
      "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa",
    );
    if (mode === "network" && typeof init?.body === "string" && init.body.includes("tools/call"))
      throw new TypeError(`request failed: https://user:${sentinel}@example.com`, {
        cause: { headers: { authorization: sentinel }, error: new Error(sentinel) },
      });
    return nativeFetch(fixture.endpoint, init);
  });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("EXA_API_KEY", `  ${sentinel}  `);
  const loaded = await discoverAndLoadExtensions(
    [resolvePath("src/index.ts")],
    directory,
    directory,
  );
  try {
    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const extension = loaded.extensions[0];
    expect([...extension.tools.keys()]).toEqual(["web_search", "web_fetch"]);
    expect([...extension.handlers.keys()]).toEqual(["session_shutdown"]);
    vi.stubEnv("EXA_API_KEY", "changed-after-startup");
    const session = SessionManager.create(directory, directory);
    session.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Local fixture tool calls" }],
      api: "openai-completions",
      provider: "openai",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    initTheme("dark", false);
    for (const name of ["web_search", "web_fetch"]) {
      const tool = extension.tools.get(name)!.definition;
      const parameters =
        name === "web_search" ? { query: "fixture" } : { url: "https://example.com" };
      for (mode of ["http", "tool", "protocol", "non-text", "network", "abort"]) {
        const controller = new AbortController();
        if (mode === "abort")
          controller.abort(new Error(sentinel, { cause: { private: sentinel } }));
        let failure: unknown;
        try {
          await Reflect.apply(Reflect.get(tool, "execute"), tool, [
            "fixture-call",
            parameters,
            controller.signal,
            undefined,
            {},
          ]);
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(Error);
        if (!(failure instanceof Error)) throw new Error("Expected Pi tool failure");
        expect(inspect(failure, { depth: 10, showHidden: true })).not.toContain(sentinel);
        expect(failure).not.toHaveProperty("cause");
        const result = {
          content: [{ type: "text" as const, text: failure.message }],
          details: {},
          isError: true,
        };
        session.appendMessage({
          role: "toolResult",
          toolCallId: "fixture-call",
          toolName: name,
          ...result,
          timestamp: Date.now(),
        });
        const component: ToolExecutionComponent = Reflect.construct(ToolExecutionComponent, [
          name,
          "fixture-call",
          parameters,
          undefined,
          tool,
          { requestRender() {} },
          directory,
        ]);
        component.updateResult(result);
        for (const expanded of [false, true]) {
          component.setExpanded(expanded);
          const rendered = component.render(500).join("\n");
          expect(rendered).not.toContain(sentinel);
          expect(rendered).toContain(mode === "abort" ? "Cancelled" : "Error");
        }
      }
    }
    const file = session.getSessionFile();
    expect(file).toBeDefined();
    const records = await readFile(file!, "utf8");
    expect(records).toContain("toolResult");
    expect(records).toContain("Operation aborted");
    expect(records).not.toContain(sentinel);
    expect(
      inspect(
        logSpies.flatMap((spy) => spy.mock.calls),
        { depth: 10 },
      ),
    ).not.toContain(sentinel);
  } finally {
    for (const extension of loaded.extensions) {
      for (const handler of extension.handlers.get("session_shutdown") ?? [])
        await Reflect.apply(handler, undefined, [{ type: "session_shutdown" }, {}]);
    }
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

async function createFixture(
  toolResponse: (
    request: CapturedRequest,
  ) => ToolReply | undefined | Promise<ToolReply | undefined>,
  options: FixtureOptions = {},
): Promise<Fixture> {
  const requests: CapturedRequest[] = [];
  let sessionNumber = 0;
  let initializeFailures = options.initializeFailures ?? 0;
  const server = createServer((incoming, response) => {
    void (async () => {
      const body = await readBody(incoming);
      const parsed: unknown = body === "" ? undefined : JSON.parse(body);
      const message = isRecord(parsed) ? parsed : undefined;
      const request: CapturedRequest = {
        method: incoming.method ?? "",
        headers: incoming.headers,
        body,
        message,
      };
      requests.push(request);
      response.on("close", () => {
        request.aborted = !response.writableFinished;
      });

      if (incoming.method === "GET") {
        response.writeHead(405).end();
        return;
      }
      if (incoming.method === "DELETE") {
        await options.deleteGate;
        response.writeHead(204).end();
        return;
      }
      if (message?.method === "server/discover") {
        response.writeHead(404).end();
        return;
      }
      if (message?.method === "initialize") {
        if (options.initializeStatus !== undefined) {
          response.writeHead(options.initializeStatus).end("private initialize failure");
          return;
        }
        if (
          initializeFailures > 0 &&
          (options.initializeFailureRoute === undefined ||
            request.headers["x-api-key"] !== undefined)
        ) {
          initializeFailures -= 1;
          response.writeHead(500).end("initialize failed");
          return;
        }
        await (typeof options.initializeGate === "function"
          ? options.initializeGate(request)
          : options.initializeGate);
        const sessionId = options.sessionless ? undefined : `test-session-${++sessionNumber}`;
        const params = getRecord(message, "params");
        sendJson(
          response,
          message.id,
          {
            protocolVersion: getString(params, "protocolVersion"),
            capabilities: { tools: {} },
            serverInfo: { name: "test-exa", version: "1.0.0" },
          },
          sessionId,
        );
        return;
      }
      if (message?.method === "notifications/initialized") {
        response.writeHead(202).end();
        return;
      }
      if (message?.method !== "tools/call") {
        response.writeHead(202).end();
        return;
      }

      const reply = await toolResponse(request);
      const sessionId =
        typeof request.headers["mcp-session-id"] === "string"
          ? request.headers["mcp-session-id"]
          : undefined;
      if (reply !== undefined && "disconnect" in reply) {
        response.destroy();
      } else if (reply !== undefined && "status" in reply) {
        response.writeHead(reply.status, reply.headers).end(reply.body);
      } else if (reply?.error !== undefined) {
        sendError(response, message.id, reply.error, sessionId);
      } else {
        sendJson(response, message.id, reply?.result, sessionId);
      }
    })().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an IP test server address");
  }

  const fixture: Fixture = {
    endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`),
    requests,
    close: () => closeServer(server),
  };
  fixtures.push(fixture);
  return fixture;
}

function getToolArgument(request: CapturedRequest, name: string): string | undefined {
  const params = getRecord(request.message, "params");
  return getString(getRecord(params, "arguments"), name);
}

function getRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> {
  const candidate = value?.[key];
  return isRecord(candidate) ? candidate : {};
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for fixture request");
}

function countRequests(fixture: Fixture, method: string): number {
  return fixture.requests.filter((request) => request.message?.method === method).length;
}

function sendJson(
  response: ServerResponse,
  id: unknown,
  result: unknown,
  sessionId: string | undefined,
): void {
  response.writeHead(200, {
    "content-type": "application/json",
    ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
  });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function sendError(
  response: ServerResponse,
  id: unknown,
  error: unknown,
  sessionId: string | undefined,
): void {
  response.writeHead(200, {
    "content-type": "application/json",
    ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
  });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, error }));
}

async function readBody(request: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
