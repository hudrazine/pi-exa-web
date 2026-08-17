import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { setTimeout as delay } from "node:timers/promises";
import packageJson from "../package.json" with { type: "json" };
import { createAnonymousFirstPolicy } from "./anonymous-first.ts";
import type { ExaWebClient } from "./register-tools.ts";

const EXA_MCP_ENDPOINT = new URL("https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa");
const CLOSED_MESSAGE = "pi-exa-web MCP client is closed";
const SESSION_TERMINATION_GRACE_MS = 1_000;

interface Connection {
  client: Client;
  transport: StreamableHTTPClientTransport;
}

export interface ExaMcpClient extends ExaWebClient {
  close(): Promise<void>;
}

export function createExaMcpClient(
  options: {
    endpoint?: URL;
    apiKey?: string;
  } = {},
): ExaMcpClient {
  const endpoint = options.endpoint ?? EXA_MCP_ENDPOINT;
  const policy = createAnonymousFirstPolicy({ fetch: globalThis.fetch, apiKey: options.apiKey });
  let connection: Connection | undefined;
  let connecting: Promise<Connection> | undefined;
  let pendingConnection: Connection | undefined;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  async function connect(): Promise<Connection> {
    const candidate: Connection = {
      client: new Client(
        { name: "pi-exa-web", version: packageJson.version },
        { versionNegotiation: { mode: "auto" } },
      ),
      transport: new StreamableHTTPClientTransport(endpoint, { fetch: policy.fetch }),
    };
    pendingConnection = candidate;

    try {
      await candidate.client.connect(candidate.transport);
      if (closed) {
        throw new Error(CLOSED_MESSAGE);
      }
      connection = candidate;
      return candidate;
    } catch (error) {
      await dispose(candidate);
      throw error;
    } finally {
      if (pendingConnection === candidate) {
        pendingConnection = undefined;
      }
    }
  }

  async function getConnection(signal: AbortSignal | undefined): Promise<Connection> {
    throwIfAborted(signal);
    if (closed) {
      throw new Error(CLOSED_MESSAGE);
    }
    if (connection !== undefined) {
      return connection;
    }

    connecting ??= connect().finally(() => {
      connecting = undefined;
    });
    return waitForSignal(connecting, signal);
  }

  async function call(
    name: "web_search_exa" | "web_fetch_exa",
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; auth: "anonymous" | "api-key" }> {
    const active = await getConnection(signal);
    if (closed) {
      throw new Error(CLOSED_MESSAGE);
    }

    const { result, auth } = await policy.run(() =>
      active.client.callTool({ name, arguments: args }, { signal }),
    );
    return { text: readText(result), auth };
  }

  function close(): Promise<void> {
    closed = true;
    closePromise ??= (async () => {
      const active = connection;
      connection = undefined;
      if (active !== undefined) {
        try {
          await Promise.race([
            active.transport.terminateSession(),
            delay(SESSION_TERMINATION_GRACE_MS, undefined, { ref: false }),
          ]);
        } catch {
          // Session termination is best-effort during Pi shutdown.
        } finally {
          await dispose(active);
        }
      }

      const pending = pendingConnection;
      if (pending !== undefined) {
        await dispose(pending);
      }
      try {
        await connecting;
      } catch {
        // Closing a handshake is expected to reject its shared promise.
      }
    })();
    return closePromise;
  }

  return {
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

function readText(result: CallToolResult): string {
  const text = result.content
    .filter(
      (block): block is Extract<(typeof result.content)[number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n\n");

  if (result.isError === true) {
    throw new Error(text || "Exa MCP tool call failed without an error message");
  }
  if (text === "") {
    throw new Error("Exa MCP returned an unexpected response without text content");
  }
  return text;
}

async function dispose(connection: Connection): Promise<void> {
  try {
    await connection.client.close();
  } catch {
    // Cleanup continues with the transport below.
  }
  try {
    await connection.transport.close();
  } catch {
    // Cleanup is best-effort after connection failure or shutdown.
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason;
  }
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    function abort(): void {
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
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
