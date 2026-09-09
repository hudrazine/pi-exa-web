# Architecture

`pi-exa-web` is a source-loaded Pi extension with one private Exa MCP connection. Pi-facing registration and rendering are separated from MCP lifecycle and authentication policy. This document describes implemented `0.1.0`; route-specific connections and persistent OAuth state belong to the [unimplemented proposal](plans/oauth-routing-design.md).

## Responsibilities and Call Flow

| Boundary | Responsibility | Source |
| --- | --- | --- |
| Extension entry | Read `EXA_API_KEY` at initialization, construct the client, register tools, and register shutdown cleanup | [`src/index.ts`](../../src/index.ts) |
| Pi adapter and renderer | Define schemas, invoke intent-level search/fetch operations, supply stable details, and render Pi results | [`src/register-tools.ts`](../../src/register-tools.ts) |
| Exa MCP client | Share a lazy connection, map tool arguments, forward cancellation, extract text/errors, and close resources | [`src/exa-mcp-client.ts`](../../src/exa-mcp-client.ts) |
| Anonymous-first policy | Observe tool-call HTTP 429, manage the process-local block deadline, and perform bounded anonymous retry/API-key replay | [`src/anonymous-first.ts`](../../src/anonymous-first.ts) |

The Pi adapter calls private `search` or `fetch` operations. The MCP client maps those intents to `web_search_exa` and `web_fetch_exa` on `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa`. A custom fetch middleware applies the [authentication policy](design/anonymous-first.md). The result returns as text and the actual authentication route; the adapter supplies the [public result metadata](design/web-tools.md).

The adapter does not inspect JSON-RPC or choose credentials. The renderer reads tool arguments, error text, and stable details; it does not parse Exa search results or read authentication state. MCP tool names and session mechanics remain private to the client.

## Connection and Cancellation

Extension loading performs no network I/O. The first tool call creates one MCP `Client` and Streamable HTTP transport; concurrent first calls await the same connection promise. Failed initialization closes partial resources and clears cached state so a later call can reconnect.

Each `Client.callTool` receives the caller's `AbortSignal`. A caller cancelled while awaiting the shared initial connection stops waiting without cancelling a connection another caller may need. The policy's optional retry delay observes the same signal. A transport failure after a tool request may have reached Exa is not automatically replayed.

`session_shutdown` invokes idempotent close. The client stops accepting work, waits at most one second for best-effort session termination, and then closes the client and transport even if termination fails or does not respond. Closing rejects in-flight SDK requests and disposes an unfinished handshake. Anonymous block state ends with the extension runtime.

## Packaging and Dependencies

[`package.json`](../../package.json) is authoritative for exact dependency versions, development runtimes, published files, and the extension entry. The current minimum Node.js version is `>=22.19.0`.

The package-owned runtime dependency is `@modelcontextprotocol/client`, providing the MCP v2 client and Streamable HTTP transport. Pi supplies `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` as peers with range `*`; concrete development versions support local checks. Any MCP server fixture dependency must remain development-only.

The manifest declares the `pi-package` keyword and a `pi.extensions` source entry, and defines no npm library export surface. Publication includes required TypeScript source, package metadata, README, and license. There is no generated `dist` artifact.

## Design Rationale

A single intent-level client keeps vendor protocol concerns out of Pi integration without introducing a general MCP framework. Authentication metadata uses a private `AsyncLocalStorage` context around each SDK tool call because concurrent calls can complete through different routes; shared last-route state would mislabel results.

Runtime `listTools()` validation is omitted. Missing or renamed upstream tools surface as MCP tool errors, while bounded release smoke tests detect drift without adding discovery latency to every user's first call. The tool contract uses the common supported inputs and omits vendor defaults because the reviewed Hosted documentation and Exa source differed on some optional inputs and defaults.
