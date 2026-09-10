# Architecture

`pi-exa-web` is a source-loaded Pi extension. A private client exposes search/fetch and management operations, separating Pi integration from MCP connections, authentication policy and persistent state. The [product requirements](product.md) define its scope; this document owns component boundaries, request flow and connection lifetime.

## Responsibilities

| Component | Responsibility | Source |
| --- | --- | --- |
| Extension entry | Pass the startup API key to the client; register tools, commands and shutdown | [index.ts](../../src/index.ts) |
| Pi tools | Define input schemas, map successful details and render results | [register-tools.ts](../../src/register-tools.ts) |
| Management UI | Validate arguments, complete fixed candidates, gate login mode and own transient UI/browser launch | [management-command.ts](../../src/management-command.ts) |
| MCP client | Map search/fetch intents, snapshot settings, resolve authentication, manage route connections and HTTP evidence | [exa-mcp-client.ts](../../src/exa-mcp-client.ts) |
| Routing policy | Primary selection, anonymous probe/cooldown and one fallback | [anonymous-first.ts](../../src/anonymous-first.ts) |
| OAuth lifecycle | Read and refresh committed credentials; serialize local logout | [oauth-state.ts](../../src/oauth-state.ts) |
| Staged login | Temporary provider/listener, exchange, validation and revision-checked commit | [oauth-login.ts](../../src/oauth-login.ts) |
| Storage | Validate records, replace JSON and coordinate OAuth transactions | [state-schema.ts](../../src/state-schema.ts), [state-store.ts](../../src/state-store.ts), [oauth-lock.ts](../../src/oauth-lock.ts) |
| Error boundary | Package-owned codes/messages and safe Pi exceptions | [errors.ts](../../src/errors.ts) |

## Tool Execution

The adapter calls private search/fetch operations. The client reads settings once, maps the request to `web_search_exa` or `web_fetch_exa`, and invokes the [routing policy](design/anonymous-first.md). Selection and fallback wrap `Client.callTool`; middleware applies route credentials and observes HTTP evidence without replaying request bodies. The same tool name and arguments are used for permitted re-execution, but JSON-RPC IDs and bodies may differ.

Each attempt classifies MCP errors before extracting successful text. Its result carries the actual successful route and optional fallback metadata directly to the adapter. Parallel calls never share a mutable last-route value. The [tool contract](design/web-tools.md) owns schemas, result details, display and safe failures.

A private `AsyncLocalStorage` context carries request HTTP evidence, signal, selected OAuth revision, tool-send state and 401 budget. Background notifications and SSE cannot overwrite that evidence. Provider storage, abort and refresh errors take precedence over an earlier HTTP 401; successful SDK replay clears preceding HTTP failure evidence.

## Connection and Cancellation

Extension loading performs no network I/O. Anonymous, OAuth and API-key routes each have a lazy Client/Streamable HTTP transport. Concurrent initialization on one route shares a promise. Failed initialization closes partial resources and clears the cached reference so later calls can reconnect.

Shared initialization belongs to the extension lifetime. Cancelling one waiter stops that wait without stopping initialization for others. Calls combine caller and lifecycle signals; middleware also attaches the call signal to tool HTTP because SDK 2.0.0 legacy protocol cancellation alone sends a notification. Refresh, lock waits and probe delays observe the operation signal.

A rejected tool request carrying a server-issued session ID may recover from HTTP 404 once with a fresh connection on that route. Non-session 404 and ambiguous transport failures do not authorize replay. Reconnection preserves the anonymous probe, OAuth 401 and fallback budgets defined in the [routing contract](design/anonymous-first.md).

Before using a cached OAuth connection, the client reads the latest revision. A changed revision retires the old connection by identity. Sent users may finish before it closes; an old initialization or parallel failure cannot overwrite or discard a newer connection. Retired initialization closes on completion without entering the cache, including when its sole waiter has cancelled. Login/logout use the same retirement mechanism after a successful commit.

`session_shutdown` invokes idempotent `close()`, returning the same promise on repeated calls. It rejects new work and aborts active calls, initialization, login, refresh/logout, lock acquisition and retry waits. Initialized sessions terminate in parallel under one shared one-second grace; all clients/transports close even when termination fails or stalls. DELETE requests are independent of aborted operation signals and use known tokens without initiating refresh. Login abort closes its listener and temporary transports without another termination grace. Shutdown awaits login and OAuth transaction cleanup before resolving.

## State and Management Boundaries

[OAuth lifecycle and state](design/oauth-state.md) owns staging, refresh, expected revisions and complete JSON replacement. The [SQLite lock contract](design/oauth-state-locking.md) owns exclusion and cleanup. There is no resident settings/credentials cache that overrides committed files. Settings do not use SQLite. OAuth refresh holds ownership from the latest-state read through remote rotation and local rename.

[Management commands](design/management.md) use private client operations. Status is read-only and never resolves or refreshes authentication. Login is explicit: normal tool providers cannot discover, register, open a browser or enter staged login. Login validation uses a fresh, read-only-token connection that never enters the normal cache or sends a tool call.

## Packaging and Design Rationale

[package.json](../../package.json) is authoritative for runtimes, dependencies and published files. Node `>=24.15.0` supports the [SQLite decision](decisions/sqlite-state-locking.md). The runtime MCP dependency is exact-pinned to `@modelcontextprotocol/client@2.0.0`; OAuth and lifecycle integration must be revalidated on upgrades. Pi supplies coding-agent, pi-tui and TypeBox peers. The published artifact contains required TypeScript source, package metadata, README and license, with no generated distribution.

One client with search/fetch operations keeps vendor protocol concerns out of Pi integration without a generic provider framework. Private construction seams support deterministic tests. There is no runtime `listTools()` discovery: missing upstream tools surface as safe MCP failures, avoiding first-call discovery latency. Hosted smoke is the separate compatibility check. Inputs use the common supported subset and omit vendor defaults because Hosted documentation and Exa source do not provide a single stable contract for optional inputs and defaults.
