import type { FetchLike } from "@modelcontextprotocol/client";
import { AsyncLocalStorage } from "node:async_hooks";

export type AuthRoute = "anonymous" | "api-key";

interface CallContext {
  auth: AuthRoute;
}

export interface AnonymousFirstPolicy {
  fetch: FetchLike;
  run<T>(operation: () => Promise<T>): Promise<{ result: T; auth: AuthRoute }>;
}

export function createAnonymousFirstPolicy(options: {
  fetch: FetchLike;
  apiKey?: string;
}): AnonymousFirstPolicy {
  const callContext = new AsyncLocalStorage<CallContext>();
  const apiKey = options.apiKey?.trim() || undefined;
  let anonymousBlockedUntil = 0;

  return {
    async fetch(input, init) {
      if (!isToolCall(init)) {
        return options.fetch(input, init);
      }

      const context = callContext.getStore();
      if (context === undefined) {
        throw new Error("tools/call must run inside anonymous-first policy context");
      }

      const now = Date.now();
      if (anonymousBlockedUntil > now) {
        return authenticatedFetch(options.fetch, apiKey, context, input, init);
      }
      anonymousBlockedUntil = 0;

      const response = await options.fetch(input, init);
      if (response.status !== 429) {
        return response;
      }

      let limit = readRateLimit(response, now);
      if (limit.fromHeader && limit.deadline - now <= 2_000) {
        await abortableDelay(Math.max(0, limit.deadline - now), init?.signal);
        const retryResponse = await options.fetch(input, init);
        if (retryResponse.status !== 429) {
          return retryResponse;
        }
        limit = readRateLimit(retryResponse, Date.now());
      }

      anonymousBlockedUntil = limit.deadline;
      return authenticatedFetch(options.fetch, apiKey, context, input, init);
    },
    async run(operation) {
      const context: CallContext = { auth: "anonymous" };
      const result = await callContext.run(context, operation);
      return { result, auth: context.auth };
    },
  };
}

function authenticatedFetch(
  fetch: FetchLike,
  apiKey: string | undefined,
  context: CallContext,
  input: string | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  if (apiKey === undefined) {
    return Promise.reject(
      new Error(
        "Exa anonymous MCP rate limit reached. Set EXA_API_KEY from https://dashboard.exa.ai/api-keys or retry later.",
      ),
    );
  }

  context.auth = "api-key";
  const headers = new Headers(init?.headers);
  headers.set("x-api-key", apiKey);
  return fetch(input, { ...init, headers });
}

function readRateLimit(response: Response, now: number): { deadline: number; fromHeader: boolean } {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (retryAfter.trim() !== "" && Number.isFinite(seconds) && seconds >= 0) {
      return { deadline: now + seconds * 1_000, fromHeader: true };
    }

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return { deadline: Math.max(now, date), fromHeader: true };
    }
  }

  const resetValue = response.headers.get("x-ratelimit-reset");
  if (resetValue !== null && resetValue.trim() !== "") {
    const reset = Number(resetValue);
    if (Number.isFinite(reset) && reset >= 0) {
      const deadline = reset >= 1_000_000_000_000 ? reset : reset * 1_000;
      return { deadline: Math.max(now, deadline), fromHeader: true };
    }
  }

  return { deadline: now + 1_000, fromHeader: false };
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal | null | undefined,
): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);

    function finish(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    function abort(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function isToolCall(init: RequestInit | undefined): boolean {
  if (init?.method?.toUpperCase() !== "POST" || typeof init.body !== "string") {
    return false;
  }

  try {
    const body: unknown = JSON.parse(init.body);
    return (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      Reflect.get(body, "method") === "tools/call"
    );
  } catch {
    return false;
  }
}
