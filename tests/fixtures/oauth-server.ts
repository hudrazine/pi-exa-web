import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";

export interface OAuthRequest {
  path: string;
  method: string;
  headers: IncomingHttpHeaders;
  form: URLSearchParams;
  message: { id?: unknown; method?: string; params?: { protocolVersion?: string; name?: string } };
}
export interface OAuthReply {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  result?: unknown;
  disconnect?: boolean;
  truncate?: boolean;
  sse?: { messages: unknown[]; onClose?: () => void };
}
export const ok = {
  content: [
    { type: "text", text: "first" },
    { type: "text", text: "second" },
  ],
};

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Only redirects the approved HTTPS origins. Discovery/registration/browser traffic is a failure.
export function forwardOAuth(origin: string, nativeFetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!["https://mcp.exa.ai", "https://auth.example.test"].includes(url.origin))
      throw new Error("Unexpected OAuth origin");
    if (!["/mcp", "/mcp/oauth", "/token"].includes(url.pathname))
      throw new Error("Unexpected discovery or interactive request");
    return nativeFetch(new URL(url.pathname + url.search, origin), init);
  };
}

export async function oauthServer(
  handle: (
    request: OAuthRequest,
  ) => OAuthReply | undefined | Promise<OAuthReply | undefined> = () => undefined,
) {
  const requests: OAuthRequest[] = [];
  let session = 0;
  let rotations = 0;
  const server = createServer((incoming, response) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const path = new URL(incoming.url!, "http://localhost").pathname;
      const request: OAuthRequest = {
        path,
        method: incoming.method!,
        headers: incoming.headers,
        form: new URLSearchParams(path === "/token" ? body : ""),
        message: path !== "/token" && body ? JSON.parse(body) : {},
      };
      requests.push(request);
      const reply = await handle(request);
      if (reply?.truncate) {
        response.writeHead(200, {
          "content-type": "application/json",
          "content-length": "100",
          connection: "close",
        });
        response.end("{");
        return;
      }
      if (reply?.disconnect) {
        response.destroy();
        return;
      }
      if (reply?.sse) {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          ...reply.headers,
        });
        if (reply.sse.onClose) response.on("close", reply.sse.onClose);
        response.flushHeaders();
        for (const message of reply.sse.messages)
          response.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
        // Keep the stream open until the client closes it; an MCP response does not require EOF.
        return;
      }
      if (reply?.status !== undefined) {
        response.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
        response.end(JSON.stringify(reply.json ?? { error: "fixture-sentinel" }));
        return;
      }
      if (path === "/token") {
        const expected = rotations === 0 ? "storage-sentinel-refresh" : `refresh-${rotations}`;
        if (request.form.get("refresh_token") !== expected) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        rotations++;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            reply?.json ?? {
              access_token: `access-${rotations}`,
              refresh_token: `refresh-${rotations}`,
              token_type: "Bearer",
              expires_in: 3600,
            },
          ),
        );
        return;
      }
      if (incoming.method === "GET") {
        response.writeHead(405).end();
        return;
      }
      if (incoming.method === "DELETE") {
        response.writeHead(204).end();
        return;
      }
      if (request.message.method === "server/discover") {
        response.writeHead(404).end();
        return;
      }
      if (request.message.method === "initialize") {
        response.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": `session-${++session}`,
        });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.message.id,
            result: {
              protocolVersion: request.message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "oauth-fixture", version: "1" },
            },
          }),
        );
        return;
      }
      if (request.message.method !== "tools/call") {
        response.writeHead(202).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ jsonrpc: "2.0", id: request.message.id, result: reply?.result ?? ok }),
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
