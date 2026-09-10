import {
  auth,
  Client,
  OAuthError,
  OAuthErrorCode,
  StreamableHTTPClientTransport,
  type FetchLike,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import packageJson from "../package.json" with { type: "json" };
import { ExaError, readRetryAt, safeError } from "./errors.ts";
import { oauthResource, parseOAuth } from "./state-schema.ts";
import type { createStateStore } from "./state-store.ts";

const accessDenied: string = OAuthErrorCode.AccessDenied;

// The provider and callback belong to this operation, never to committed credentials.
export async function loginOAuth(
  store: ReturnType<typeof createStateStore>,
  fetchFn: FetchLike,
  onAuthorization: (url: URL) => void,
  callerSignal: AbortSignal,
) {
  const stopped = new AbortController();
  const signal = AbortSignal.any([callerSignal, stopped.signal]);
  const timer = setTimeout(() => stopped.abort(new ExaError("login-timeout")), 300_000);
  let state = randomBytes(32).toString("base64url");
  let verifier: string | undefined;
  let tokens: StoredOAuthTokens | undefined;
  let clientInformation: StoredOAuthClientInformation | undefined;
  let discovery: OAuthDiscoveryState | undefined;
  let expiresAt: number | undefined;
  let receivedAt = 0;
  let accepted = false;
  let receive!: (params: URLSearchParams) => void;
  const callback = new Promise<URLSearchParams>((resolve) => {
    receive = resolve;
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (!URL.canParse(request.url ?? "/", "http://127.0.0.1")) {
      response.writeHead(400).end("Not available.");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback" || request.method !== "GET") {
      response.writeHead(url.pathname === "/callback" ? 405 : 404).end("Not available.");
      return;
    }
    const params = url.searchParams;
    if (
      accepted ||
      params.get("state") !== state ||
      [...params.keys()].some((key) => params.getAll(key).length !== 1) ||
      Boolean(params.get("code")) === Boolean(params.get("error")) ||
      (params.has("code") && params.has("error"))
    ) {
      stopped.abort(new ExaError("authentication"));
      response.writeHead(400).end("Login callback rejected. Return to Pi.");
      return;
    }
    accepted = true;
    receive(params);
    response.writeHead(200).end("Login callback received. Return to Pi for the result.");
  });
  let completion: StreamableHTTPClientTransport | undefined;
  let cleanupPromise: Promise<void> | undefined;
  function cleanup(): Promise<void> {
    cleanupPromise ??= (async () => {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => completion?.close()),
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => {
            if (error && Reflect.get(error, "code") !== "ERR_SERVER_NOT_RUNNING") reject(error);
            else resolve();
          });
        }),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        signal.throwIfAborted();
        throw new ExaError("storage");
      }
    })();
    return cleanupPromise.catch(() => {
      // Recheck when reusing a failed cleanup promise: cancellation still owns its reason.
      signal.throwIfAborted();
      throw new ExaError("storage");
    });
  }
  const loginFetch: FetchLike = async (input, init) => {
    signal.throwIfAborted();
    try {
      const response = await fetchFn(input, {
        ...init,
        signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
      });
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (response.ok && mediaType === "text/event-stream") {
        // Let MCP consume streaming responses; token bodies below still establish receipt time.
        signal.throwIfAborted();
        return response;
      }
      const body = await response.arrayBuffer();
      receivedAt = Date.now();
      signal.throwIfAborted();
      if (response.status === 429)
        throw new ExaError("authenticated-rate-limit", readRetryAt(response.headers, receivedAt));
      if (response.status >= 500 && response.status <= 599) throw new ExaError("server");
      return response.body === null
        ? response
        : new Response(body, {
            status: response.status,
            headers: response.headers,
          });
    } catch (error) {
      signal.throwIfAborted();
      throw safeError(error);
    }
  };
  try {
    signal.throwIfAborted();
    const previous = await store.readOAuth();
    signal.throwIfAborted();
    await withSignal(
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0, signal }, resolve);
      }),
      signal,
    );
    signal.throwIfAborted();
    const address = server.address();
    if (!address || typeof address === "string") throw new ExaError("authentication");
    const redirectUrl = `http://127.0.0.1:${address.port}/callback`;
    let savedClient = previous.credentials?.clientInformation;
    const provider: OAuthClientProvider = {
      redirectUrl,
      clientMetadata: {
        client_name: "pi-exa-web",
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      state: () => state,
      clientInformation(ctx) {
        if (clientInformation) return clientInformation;
        if (
          savedClient &&
          ctx?.issuer === savedClient.issuer &&
          "redirect_uris" in savedClient &&
          savedClient.redirect_uris.includes(redirectUrl)
        ) {
          clientInformation = savedClient;
        }
        return clientInformation;
      },
      saveClientInformation(value) {
        clientInformation = value;
      },
      tokens: () => tokens,
      saveTokens(value) {
        tokens = value;
        expiresAt =
          value.expires_in === undefined ? undefined : receivedAt + value.expires_in * 1_000;
      },
      saveDiscoveryState(value) {
        discovery = value;
      },
      discoveryState: () => discovery,
      saveCodeVerifier(value) {
        verifier = value;
      },
      codeVerifier() {
        if (!verifier) throw new ExaError("authentication");
        return verifier;
      },
      redirectToAuthorization(url) {
        signal.throwIfAborted();
        if (url.protocol !== "https:" || url.username || url.password)
          throw new ExaError("authentication");
        onAuthorization(url);
      },
      invalidateCredentials(scope) {
        if (scope === "all" || scope === "client") {
          clientInformation = undefined;
          savedClient = undefined;
        }
        if (scope === "all" || scope === "tokens") {
          tokens = undefined;
          expiresAt = undefined;
        }
        if (scope === "all" || scope === "discovery") discovery = undefined;
        if (scope === "all" || scope === "verifier") verifier = undefined;
      },
    };
    completion = new StreamableHTTPClientTransport(new URL(oauthResource), {
      authProvider: provider,
      fetch: loginFetch,
    });
    if ((await auth(provider, { serverUrl: oauthResource, fetchFn: loginFetch })) !== "REDIRECT")
      throw new ExaError("authentication");
    const params = await withSignal(callback, signal);
    signal.throwIfAborted();
    await completion.finishAuth(params);
    signal.throwIfAborted();
    const credentials = parseOAuth({
      version: 1,
      revision: 0,
      credentials: {
        resource: oauthResource,
        tokens,
        clientInformation,
        discovery,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        loginRequired: false,
      },
    }).credentials!;
    const client = new Client(
      { name: "pi-exa-web", version: packageJson.version },
      {
        versionNegotiation: { mode: "auto" },
      },
    );
    const transport = new StreamableHTTPClientTransport(new URL(oauthResource), {
      fetch: loginFetch,
      authProvider: {
        token: async () => credentials.tokens.access_token,
        onUnauthorized() {
          throw new ExaError("authentication");
        },
      },
      onInsufficientScope: "throw",
    });
    async function closeValidation(): Promise<void> {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => client.close()),
        Promise.resolve().then(() => transport.close()),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        signal.throwIfAborted();
        throw new ExaError("storage");
      }
    }
    try {
      await client.connect(transport, { signal });
      signal.throwIfAborted();
    } finally {
      await closeValidation();
    }
    // Stop accepting callbacks and close temporary transports before entering the commit boundary.
    await cleanup();
    signal.throwIfAborted();
    return await store.updateOAuth(async () => credentials, {
      expectedRevision: previous.revision,
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof OAuthError && error.code === accessDenied)
      throw new ExaError("login-denied");
    throw error instanceof ExaError ? safeError(error) : new ExaError("authentication");
  } finally {
    clearTimeout(timer);
    tokens = undefined;
    clientInformation = undefined;
    discovery = undefined;
    verifier = undefined;
    state = "";
    await cleanup();
  }
}

function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
