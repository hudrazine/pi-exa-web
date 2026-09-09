import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { AsyncLocalStorage } from "node:async_hooks";
import packageJson from "../package.json" with { type: "json" };
import { createAnonymousFirstPolicy, type AuthRoute, type Fallback } from "./anonymous-first.ts";
import { AnonymousRateLimitError, ExaError, readRetryAt, safeError } from "./errors.ts";
import { createStateStore } from "./state-store.ts";
import type { Strategy } from "./state-schema.ts";
import type { ExaWebClient } from "./register-tools.ts";

const EXA_MCP_ENDPOINT = new URL("https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa");
const SESSION_TERMINATION_GRACE_MS = 1_000;

interface Connection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  disposing?: Promise<void>;
  users: number;
  retired?: boolean;
}

interface RouteState {
  connection?: Connection;
  connecting?: Promise<Connection>;
}

interface Observation {
  phase: "connect" | "tool";
  failure?: ExaError;
  expiredSession?: boolean;
  signal?: AbortSignal;
}

export interface ExaMcpClient extends ExaWebClient {
  getStrategy(): Promise<Strategy>;
  setStrategy(strategy: Strategy): Promise<Strategy>;
  close(): Promise<void>;
}

export function createExaMcpClient(
  options: { endpoint?: URL; apiKey?: string } = {},
): ExaMcpClient {
  const endpoint = options.endpoint ?? EXA_MCP_ENDPOINT;
  const apiKey = options.apiKey?.trim() || undefined;
  const policy = createAnonymousFirstPolicy(apiKey !== undefined);
  const store = createStateStore();
  const routes: Record<AuthRoute, RouteState> = { anonymous: {}, "api-key": {} };
  const observations = new AsyncLocalStorage<Observation>();
  const resources = new Set<Connection>();
  const lifecycle = new AbortController();
  const baseFetch = globalThis.fetch;
  let closePromise: Promise<void> | undefined;

  function routeFetch(route: AuthRoute): FetchLike {
    return async (input, init) => {
      const headers = new Headers(init?.headers);
      if (route === "api-key" && apiKey !== undefined) headers.set("x-api-key", apiKey);
      const termination = init?.method === "DELETE";
      const context = observations.getStore();
      const method = requestMethod(init);
      const signals = [
        ...(init?.signal ? [init.signal] : []),
        ...(termination ? [] : [lifecycle.signal]),
        ...(method === "tools/call" && context?.signal ? [context.signal] : []),
      ];
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      // Background SSE and notifications must not overwrite the invoking request's evidence.
      const observed =
        context !== undefined &&
        (context.phase === "tool"
          ? method === "tools/call"
          : method === "initialize" || method === "server/discover");
      if (observed) {
        context.failure = undefined;
        context.expiredSession = false;
      }
      const response = await baseFetch(input, { ...init, headers, signal });
      if (observed && !response.ok) {
        const status = response.status;
        const code =
          status === 429
            ? route === "api-key"
              ? "authenticated-rate-limit"
              : method === "tools/call"
                ? "anonymous-rate-limit"
                : "transport"
            : status === 401
              ? "authentication"
              : status === 403
                ? "permission"
                : status >= 500 && status <= 599
                  ? "server"
                  : "transport";
        const observedAt = Date.now();
        const retryAt = status === 429 ? readRetryAt(response.headers, observedAt) : undefined;
        context.failure =
          code === "anonymous-rate-limit"
            ? new AnonymousRateLimitError(observedAt, retryAt)
            : new ExaError(code, retryAt);
        context.expiredSession =
          status === 404 && method === "tools/call" && headers.has("mcp-session-id");
      }
      return response;
    };
  }

  async function connect(route: AuthRoute): Promise<Connection> {
    const candidate: Connection = {
      users: 0,
      client: new Client(
        { name: "pi-exa-web", version: packageJson.version },
        { versionNegotiation: { mode: "auto" } },
      ),
      transport: new StreamableHTTPClientTransport(endpoint, { fetch: routeFetch(route) }),
    };
    resources.add(candidate);
    const context: Observation = { phase: "connect" };
    try {
      await observations.run(context, () => candidate.client.connect(candidate.transport));
      lifecycle.signal.throwIfAborted();
      routes[route].connection = candidate;
      return candidate;
    } catch (error) {
      await dispose(candidate);
      lifecycle.signal.throwIfAborted();
      throw context.failure ?? classify(error);
    }
  }

  async function getConnection(route: AuthRoute, signal: AbortSignal): Promise<Connection> {
    signal.throwIfAborted();
    const state = routes[route];
    let active = state.connection;
    if (active === undefined) {
      state.connecting ??= connect(route).finally(() => {
        state.connecting = undefined;
      });
      active = await waitForSignal(state.connecting, signal);
    }
    signal.throwIfAborted();
    if (active.retired) return getConnection(route, signal);
    // Reserve before returning across the await boundary so retirement cannot close a new user.
    active.users++;
    return active;
  }

  async function call(
    name: "web_search_exa" | "web_fetch_exa",
    args: Record<string, unknown>,
    callerSignal: AbortSignal | undefined,
  ): Promise<{ text: string; auth: AuthRoute; fallback?: Fallback }> {
    const signal = AbortSignal.any([
      lifecycle.signal,
      ...(callerSignal === undefined ? [] : [callerSignal]),
    ]);
    // A probe is still part of the same route attempt: reconnection cannot reset its budget.
    const recovered = new Set<AuthRoute>();
    async function attempt(route: AuthRoute): Promise<string> {
      for (;;) {
        signal.throwIfAborted();
        const active = await getConnection(route, signal);
        const context: Observation = { phase: "tool", signal };
        try {
          signal.throwIfAborted();
          const result = await observations.run(context, () =>
            active.client.callTool({ name, arguments: args }, { signal }),
          );
          return readText(result, name, route);
        } catch (error) {
          signal.throwIfAborted();
          if (context.expiredSession) {
            if (routes[route].connection === active) routes[route].connection = undefined;
            active.retired = true;
            if (!recovered.has(route)) {
              recovered.add(route);
              continue;
            }
          }
          throw context.failure ?? classify(error);
        } finally {
          active.users--;
          if (active.retired && active.users === 0) await dispose(active);
        }
      }
    }
    try {
      signal.throwIfAborted();
      const { strategy } = await store.readSettings();
      signal.throwIfAborted();
      const { result, auth, fallback } = await policy.run(attempt, signal, strategy);
      signal.throwIfAborted();
      return { text: result, auth, ...(fallback === undefined ? {} : { fallback }) };
    } catch (error) {
      signal.throwIfAborted();
      throw safeError(error);
    }
  }

  function dispose(connection: Connection): Promise<void> {
    connection.disposing ??= (async () => {
      try {
        await connection.client.close();
      } catch {
        // Always attempt transport cleanup as well.
      }
      try {
        await connection.transport.close();
      } catch {
        // Cleanup is best-effort; never expose SDK cleanup exceptions.
      }
      resources.delete(connection);
    })();
    return connection.disposing;
  }

  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise;
    lifecycle.abort(new ExaError("lifecycle"));
    policy.clear();
    closePromise = (async () => {
      const initialized = Object.values(routes).flatMap((state) =>
        state.connection === undefined ? [] : [state.connection],
      );
      for (const state of Object.values(routes)) state.connection = undefined;
      const pending = [...resources].filter((resource) => !initialized.includes(resource));
      const pendingCleanup = Promise.all(pending.map(dispose));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled(initialized.map((active) => active.transport.terminateSession())),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, SESSION_TERMINATION_GRACE_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        await Promise.all([...resources].map(dispose));
        await pendingCleanup;
        await Promise.allSettled(
          Object.values(routes).flatMap((state) =>
            state.connecting === undefined ? [] : [state.connecting],
          ),
        );
      }
    })();
    return closePromise;
  }

  return {
    async getStrategy() {
      lifecycle.signal.throwIfAborted();
      const { strategy } = await store.readSettings();
      lifecycle.signal.throwIfAborted();
      return strategy;
    },
    async setStrategy(strategy) {
      lifecycle.signal.throwIfAborted();
      return (await store.writeSettings({ version: 1, strategy }, lifecycle.signal)).strategy;
    },
    search(parameters, signal) {
      return call(
        "web_search_exa",
        {
          query: parameters.query,
          ...(parameters.numResults === undefined ? {} : { numResults: parameters.numResults }),
        },
        signal,
      );
    },
    fetch(parameters, signal) {
      return call(
        "web_fetch_exa",
        {
          urls: [parameters.url],
          ...(parameters.maxCharacters === undefined
            ? {}
            : { maxCharacters: parameters.maxCharacters }),
        },
        signal,
      );
    },
    close,
  };
}

function classify(error: unknown): ExaError {
  return error instanceof ProtocolError ||
    (error instanceof SdkError && error.code === SdkErrorCode.InvalidResult)
    ? new ExaError("tool")
    : safeError(error);
}

function requestMethod(init: RequestInit | undefined): unknown {
  if (init?.method !== "POST" || typeof init.body !== "string") return undefined;
  const body: unknown = JSON.parse(init.body);
  return typeof body === "object" && body !== null ? Reflect.get(body, "method") : undefined;
}

function readText(result: CallToolResult, name: string, route: AuthRoute): string {
  if (result.isError === true) {
    const first = result.content.find((block) => block.type === "text");
    if (route === "api-key" && first?.type === "text") {
      if (first.text.startsWith(`${name} error (402):`)) throw new ExaError("credits-exhausted");
      if (first.text.startsWith(`${name} error (429):`))
        throw new ExaError("authenticated-rate-limit");
    }
    throw new ExaError("tool");
  }
  const text = result.content
    .filter(
      (block): block is Extract<(typeof result.content)[number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n\n");
  if (text === "") throw new ExaError("tool");
  return text;
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    function abort(): void {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
