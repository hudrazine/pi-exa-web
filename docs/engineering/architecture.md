# Architecture

`pi-exa-web` is a source-loaded Pi extension with separate lazy MCP connections for anonymous and API-key access. Pi-facing registration and rendering are separated from MCP lifecycle and authentication policy. This document describes merged PR1 and local PR2 changes over `0.1.0`. Private persistence is implemented; OAuth operations and selectable routing remain [accepted, unimplemented work](proposals/oauth-routing.md).

## Responsibilities and Call Flow

| Boundary | Responsibility | Source |
| --- | --- | --- |
| Extension entry | Read `EXA_API_KEY` at initialization, construct the client, register tools, and register shutdown cleanup | [`src/index.ts`](../../src/index.ts) |
| Pi adapter and renderer | Define schemas, invoke intent-level search/fetch operations, supply stable details, and render Pi results | [`src/register-tools.ts`](../../src/register-tools.ts) |
| Exa MCP client | Manage lazy route connections, map tool arguments, observe HTTP failures, forward cancellation, and close resources | [`src/exa-mcp-client.ts`](../../src/exa-mcp-client.ts) |
| Anonymous-first policy | Select routes around SDK calls, manage the process-local block deadline, and perform bounded anonymous retry/API-key fallback | [`src/anonymous-first.ts`](../../src/anonymous-first.ts) |

The Pi adapter calls private `search` or `fetch` operations. The MCP client maps those intents to `web_search_exa` and `web_fetch_exa` on `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa`. The [authentication policy](design/anonymous-first.md) selects routes outside `Client.callTool`; middleware applies route credentials and observes HTTP evidence without replaying bodies. The result returns as text and the actual authentication route; the adapter supplies the [public result metadata](design/web-tools.md).

The adapter does not inspect JSON-RPC or choose credentials. The renderer reads tool arguments, error text, and stable details; it does not parse Exa search results or read authentication state. MCP tool names and session mechanics remain private to the client.

## Connection and Cancellation

Extension loading performs no network I/O. Each route creates its MCP `Client` and Streamable HTTP transport only when needed; concurrent connects on that route share a promise. Failed initialization closes partial resources and clears cached state so a later call can reconnect. API-key initialization carries `x-api-key`; anonymous requests never do.

Each `Client.callTool` receives the combined caller/lifecycle signal. Middleware also attaches the call's signal to tool HTTP because SDK 2.0.0's legacy protocol cancellation only sends a notification. A caller cancelled while awaiting shared initialization stops waiting without cancelling that connection. Retry delays observe the same call signal.

An HTTP 404 permits one fresh connection per route attempt only when the rejected tool request carried a server-issued session ID. Reconnection does not reset the anonymous probe budget. Retired connections stop accepting new calls and close after their existing users finish, so parallel responses can still be classified. Ambiguous transport failures are not automatically replayed.

`session_shutdown` invokes idempotent close. It immediately aborts active calls, retry waits, and initialization, and rejects new work. Initialized sessions terminate in parallel under one shared one-second grace, after which all clients and transports close even if termination fails or stalls. Termination requests are independent of the aborted operation signal. Anonymous block state is cleared.

## Private State Foundation

`src/state-store.ts` uses Pi's `getAgentDir()` and canonicalizes the state directory. It has no cache or public path override. `src/state-schema.ts` validates records against version 1 and pinned SDK schemas. Settings use complete JSON replacement without SQLite. OAuth updates use `src/oauth-lock.ts`, with a connection per transaction, to reload the latest state and compare an optional expected revision before invoking the update callback. Returning `undefined` leaves JSON unchanged; credentials or `null` commit the next revision. SQLite rollback cannot undo JSON rename. The store is not yet wired into calls or commands; later PRs supply their signals and OAuth operations. See the [state contract](proposals/oauth-state.md#transactions-and-revisions).

## Packaging and Dependencies

[`package.json`](../../package.json) is authoritative for dependencies, runtimes, published files and the entry. PR2 raises the checkout's runtime floor to Node `>=24.15.0` under the [SQLite decision](decisions/sqlite-state-locking.md), without changing the package version before release.

The package-owned runtime dependency is exact-pinned `@modelcontextprotocol/client@2.0.0`, providing the MCP v2 client and Streamable HTTP transport. Pi supplies `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` as peers with range `*`; concrete development versions support local checks. Any MCP server fixture dependency must remain development-only.

The manifest declares the `pi-package` keyword and a `pi.extensions` source entry, and defines no npm library export surface. Publication includes required TypeScript source, package metadata, README, and license. There is no generated `dist` artifact.

## Design Rationale

A single intent-level client keeps vendor protocol concerns out of Pi integration. These requirements need no generic provider interface, MCP adapter, dependency-injection container, or configuration subsystem. Private construction seams support deterministic tests. The executor returns the actual successful route directly. A private `AsyncLocalStorage` context carries only the current SDK operation's HTTP evidence and signal; background notifications and SSE cannot overwrite that evidence. Package-owned errors in `src/errors.ts` replace upstream exceptions before they reach Pi.

Runtime `listTools()` validation is omitted. Missing or renamed upstream tools surface as MCP tool errors, while bounded release smoke tests detect drift without adding discovery latency to every user's first call. The tool contract uses the common supported inputs and omits vendor defaults because the reviewed Hosted documentation and Exa source differed on some optional inputs and defaults.
