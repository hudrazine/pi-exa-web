import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, test } from "vite-plus/test";
import packageJson from "../package.json" with { type: "json" };
import { createExaMcpClient } from "../src/exa-mcp-client.ts";

interface CapturedRequest {
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
  message?: Record<string, unknown>;
}

interface Fixture {
  endpoint: URL;
  requests: CapturedRequest[];
  close(): Promise<void>;
}

type ToolReply =
  | { result?: unknown; error?: unknown }
  | { status: number; headers?: Record<string, string>; body?: string };

interface FixtureOptions {
  deleteGate?: Promise<void>;
  initializeGate?: Promise<void>;
  initializeFailures?: number;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
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

  test("reports MCP tool errors and unexpected content without wrapping protocol errors", async () => {
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
      "safe Exa error",
    );
    await expect(client.search({ query: "no text" }, undefined)).rejects.toThrow(
      "unexpected response without text content",
    );
    await expect(client.search({ query: "protocol error" }, undefined)).rejects.toThrow(
      "fixture protocol error",
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

  test("replays the exact SDK body with an API key while preserving concurrent auth routes", async () => {
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
      apiKey: "test-secret-key",
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
    expect(searchRequests[0]?.body).toBe(searchRequests[1]?.body);
    expect(searchRequests[0]?.headers["x-api-key"]).toBeUndefined();
    expect(searchRequests[1]?.headers["x-api-key"]).toBe("test-secret-key");
    expect(
      fixture.requests
        .filter((request) => request.message?.method !== "tools/call")
        .every((request) => request.headers["x-api-key"] === undefined),
    ).toBe(true);
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

    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await firstClose;
    await expect(pending).rejects.toThrow();
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

async function createFixture(
  toolResponse: (
    request: CapturedRequest,
  ) => ToolReply | undefined | Promise<ToolReply | undefined>,
  options: FixtureOptions = {},
): Promise<Fixture> {
  const requests: CapturedRequest[] = [];
  let sessionId: string | undefined;
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
        if (initializeFailures > 0) {
          initializeFailures -= 1;
          response.writeHead(500).end("initialize failed");
          return;
        }
        await options.initializeGate;
        sessionId = "test-session";
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
      if (reply !== undefined && "status" in reply) {
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
