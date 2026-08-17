import type { FetchLike } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createAnonymousFirstPolicy } from "../src/anonymous-first.ts";

const MCP_URL = "https://mcp.exa.ai/mcp";
const TOOL_CALL_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "web_search_exa", arguments: { query: "Pi" } },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("anonymous-first policy", () => {
  test("passes non-tool requests through unchanged", async () => {
    const response = new Response(null, { status: 202 });
    const baseFetch = vi.fn<FetchLike>().mockResolvedValue(response);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch });
    const signal = new AbortController().signal;
    const init: RequestInit = {
      method: "POST",
      headers: { "mcp-session-id": "session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      signal,
    };

    await expect(policy.fetch(MCP_URL, init)).resolves.toBe(response);
    expect(baseFetch).toHaveBeenCalledOnce();
    expect(baseFetch).toHaveBeenCalledWith(MCP_URL, init);
  });

  test("passes malformed and non-string bodies through without inspecting them", async () => {
    const baseFetch = vi.fn<FetchLike>().mockResolvedValue(new Response("ok"));
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch });
    const malformed: RequestInit = { method: "POST", body: "{" };
    const binary: RequestInit = { method: "POST", body: new Blob([TOOL_CALL_BODY]) };

    await policy.fetch(MCP_URL, malformed);
    await policy.fetch(MCP_URL, binary);

    expect(baseFetch.mock.calls).toEqual([
      [MCP_URL, malformed],
      [MCP_URL, binary],
    ]);
  });

  test("rejects a tool call outside the call-local context before sending it", async () => {
    const baseFetch = vi.fn<FetchLike>();
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch });

    await expect(policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY })).rejects.toThrow(
      "tools/call must run inside anonymous-first policy context",
    );
    expect(baseFetch).not.toHaveBeenCalled();
  });

  test("reports an ordinary tool call as anonymous", async () => {
    const response = new Response("ok");
    const baseFetch = vi.fn<FetchLike>().mockResolvedValue(response);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });

    await expect(
      policy.run(() =>
        policy.fetch(MCP_URL, {
          method: "POST",
          body: TOOL_CALL_BODY,
        }),
      ),
    ).resolves.toEqual({ result: response, auth: "anonymous" });
    expect(baseFetch).toHaveBeenCalledOnce();
    expect(new Headers(baseFetch.mock.calls[0]?.[1]?.headers).has("x-api-key")).toBe(false);
  });

  test("waits for a short rate limit and retries anonymously once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const success = new Response("ok");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "1" }))
      .mockResolvedValueOnce(success);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });

    const pending = policy.run(() =>
      policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ result: success, auth: "anonymous" });
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(new Headers(baseFetch.mock.calls[1]?.[1]?.headers).has("x-api-key")).toBe(false);
  });

  test("falls back immediately with an API key after a long rate limit", async () => {
    const authenticated = new Response("authenticated");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "3" }))
      .mockResolvedValueOnce(authenticated);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });
    const signal = new AbortController().signal;
    const init: RequestInit = {
      method: "POST",
      headers: { "mcp-session-id": "session" },
      body: TOOL_CALL_BODY,
      signal,
    };

    await expect(policy.run(() => policy.fetch(MCP_URL, init))).resolves.toEqual({
      result: authenticated,
      auth: "api-key",
    });
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(baseFetch.mock.calls[1]?.[0]).toBe(MCP_URL);
    expect(baseFetch.mock.calls[1]?.[1]?.body).toBe(TOOL_CALL_BODY);
    expect(baseFetch.mock.calls[1]?.[1]?.signal).toBe(signal);
    const authenticatedHeaders = new Headers(baseFetch.mock.calls[1]?.[1]?.headers);
    expect(authenticatedHeaders.get("mcp-session-id")).toBe("session");
    expect(authenticatedHeaders.get("x-api-key")).toBe("secret");
  });

  test("falls back immediately when a rate limit has no deadline headers", async () => {
    const authenticated = new Response("authenticated");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(authenticated);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });

    await expect(
      policy.run(() => policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY })),
    ).resolves.toEqual({ result: authenticated, auth: "api-key" });
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  test("blocks without sending again when no API key is available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "60" }));
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch });
    const call = () =>
      policy.run(() => policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }));

    await expect(call()).rejects.toThrow(
      "Exa anonymous MCP rate limit reached. Set EXA_API_KEY from https://dashboard.exa.ai/api-keys or retry later.",
    );
    await expect(call()).rejects.toThrow("EXA_API_KEY");
    expect(baseFetch).toHaveBeenCalledOnce();
  });

  test.each([
    {
      name: "HTTP date",
      headers: { "Retry-After": "Mon, 17 Aug 2026 00:00:04 GMT" },
    },
    {
      name: "reset epoch milliseconds",
      headers: { "X-RateLimit-Reset": "1786924804000" },
    },
    {
      name: "reset epoch seconds",
      headers: { "X-RateLimit-Reset": "1786924804" },
    },
  ])("uses $name as the anonymous block deadline", async ({ headers }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const success = new Response("available again");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse(headers))
      .mockResolvedValueOnce(success);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch });
    const call = () =>
      policy.run(() => policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }));

    await expect(call()).rejects.toThrow("EXA_API_KEY");
    await vi.advanceTimersByTimeAsync(3_999);
    await expect(call()).rejects.toThrow("EXA_API_KEY");
    expect(baseFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(call()).resolves.toEqual({ result: success, auth: "anonymous" });
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  test("uses a one-second block for invalid rate-limit headers without retrying", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const success = new Response("available again");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        rateLimitResponse({ "Retry-After": "invalid", "X-RateLimit-Reset": "invalid" }),
      )
      .mockResolvedValueOnce(success);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch });
    const call = () =>
      policy.run(() => policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }));

    await expect(call()).rejects.toThrow("EXA_API_KEY");
    expect(baseFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(call()).resolves.toEqual({ result: success, auth: "anonymous" });
  });

  test("uses the second anonymous 429 to block and then falls back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
    const authenticated = new Response("authenticated");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "1" }))
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "30" }))
      .mockResolvedValueOnce(authenticated);
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });

    const pending = policy.run(() =>
      policy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }),
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({ result: authenticated, auth: "api-key" });
    expect(baseFetch).toHaveBeenCalledTimes(3);
    expect(new Headers(baseFetch.mock.calls[1]?.[1]?.headers).has("x-api-key")).toBe(false);
    expect(new Headers(baseFetch.mock.calls[2]?.[1]?.headers).get("x-api-key")).toBe("secret");
  });

  test("treats authenticated HTTP and network failures as final", async () => {
    const authenticated429 = rateLimitResponse({ "Retry-After": "1" });
    const rateLimitedFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "3" }))
      .mockResolvedValueOnce(authenticated429);
    const rateLimitedPolicy = createAnonymousFirstPolicy({
      fetch: rateLimitedFetch,
      apiKey: "secret",
    });

    await expect(
      rateLimitedPolicy.run(() =>
        rateLimitedPolicy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }),
      ),
    ).resolves.toEqual({ result: authenticated429, auth: "api-key" });
    expect(rateLimitedFetch).toHaveBeenCalledTimes(2);

    const serverError = new Response("failed", { status: 503 });
    const serverErrorFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "3" }))
      .mockResolvedValueOnce(serverError);
    const serverErrorPolicy = createAnonymousFirstPolicy({
      fetch: serverErrorFetch,
      apiKey: "secret",
    });

    await expect(
      serverErrorPolicy.run(() =>
        serverErrorPolicy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }),
      ),
    ).resolves.toEqual({ result: serverError, auth: "api-key" });
    expect(serverErrorFetch).toHaveBeenCalledTimes(2);

    const networkError = new TypeError("network failed");
    const failingFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "3" }))
      .mockRejectedValueOnce(networkError);
    const failingPolicy = createAnonymousFirstPolicy({ fetch: failingFetch, apiKey: "secret" });

    await expect(
      failingPolicy.run(() =>
        failingPolicy.fetch(MCP_URL, { method: "POST", body: TOOL_CALL_BODY }),
      ),
    ).rejects.toBe(networkError);
    expect(failingFetch).toHaveBeenCalledTimes(2);
    expect(networkError.message).not.toContain("secret");
  });

  test("stops a short retry delay immediately when aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const baseFetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(rateLimitResponse({ "Retry-After": "2" }));
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });

    const pending = policy.run(() =>
      policy.fetch(MCP_URL, {
        method: "POST",
        body: TOOL_CALL_BODY,
        signal: controller.signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    await vi.runAllTimersAsync();
    expect(baseFetch).toHaveBeenCalledOnce();
  });

  test("keeps authentication routes isolated across parallel calls", async () => {
    const fallbackBody = TOOL_CALL_BODY;
    const anonymousBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "web_fetch_exa", arguments: { urls: ["https://pi.dev"] } },
    });
    const baseFetch = vi.fn<FetchLike>(async (input, init) => {
      expect(input).toBe(MCP_URL);
      const headers = new Headers(init?.headers);
      if (init?.body === fallbackBody && !headers.has("x-api-key")) {
        return rateLimitResponse({ "Retry-After": "3" });
      }
      return new Response(init?.body === fallbackBody ? "authenticated" : "anonymous");
    });
    const policy = createAnonymousFirstPolicy({ fetch: baseFetch, apiKey: "secret" });

    const [fallback, anonymous] = await Promise.all([
      policy.run(() => policy.fetch(MCP_URL, { method: "POST", body: fallbackBody })),
      policy.run(() => policy.fetch(MCP_URL, { method: "POST", body: anonymousBody })),
    ]);

    expect(fallback.auth).toBe("api-key");
    expect(anonymous.auth).toBe("anonymous");
    expect(baseFetch.mock.calls.every(([input]) => input === MCP_URL)).toBe(true);
  });
});

function rateLimitResponse(headers: Record<string, string | undefined> = {}): Response {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      responseHeaders.set(name, value);
    }
  }
  return new Response("rate limited", { status: 429, headers: responseHeaders });
}
