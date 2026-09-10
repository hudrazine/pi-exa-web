# Architecture

`pi-exa-web` is a source-loaded Pi extension with separate lazy MCP connections for anonymous, OAuth and API-key access. Pi-facing registration and rendering are separated from MCP lifecycle and authentication policy. This document describes merged, unreleased PR1–PR5 changes over `0.1.0`, including interactive login and management. [Hosted verification and release work](plans/oauth-routing.md) remain pending.

## Responsibilities and Call Flow

| Boundary | Responsibility | Source |
| --- | --- | --- |
| Extension entry | Read `EXA_API_KEY` at initialization, construct the client, register tools and `/exa`, and register shutdown cleanup | [`src/index.ts`](../../src/index.ts) |
| Management command | Validate subcommands, gate login by `ctx.mode`, own transient/cancellable UI and best-effort browser launch, display safe local status and commit results | [`src/management-command.ts`](../../src/management-command.ts) |
| Pi adapter and renderer | Define schemas, invoke intent-level search/fetch operations, supply stable details, and render Pi results | [`src/register-tools.ts`](../../src/register-tools.ts) |
| Exa MCP client | Manage lazy route connections, map tool arguments, snapshot settings, classify HTTP/MCP failures, forward cancellation, and close resources | [`src/exa-mcp-client.ts`](../../src/exa-mcp-client.ts) |
| OAuth state manager | Resolve saved credentials, refresh under the SQLite transaction, commit terminal rejection, and perform local logout | [`src/oauth-state.ts`](../../src/oauth-state.ts) |
| Staged login | Own one operation's provider, loopback listener, five-minute deadline, discovery/exchange, read-only validation connection and expected-revision commit | [`src/oauth-login.ts`](../../src/oauth-login.ts) |
| Anonymous-first policy | Select routes around SDK calls, apply the strategy snapshot and process-local cooldown, with bounded probes and one bidirectional fallback | [`src/anonymous-first.ts`](../../src/anonymous-first.ts) |

The Pi adapter calls private `search` or `fetch` operations. The MCP client maps those intents to `web_search_exa` and `web_fetch_exa` on `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa` for anonymous/API-key access or `https://mcp.exa.ai/mcp/oauth` for OAuth. The [authentication policy](design/anonymous-first.md) selects routes outside `Client.callTool`; middleware applies route credentials and observes HTTP evidence without replaying bodies. Each route classifies MCP tool errors before returning successful text, allowing only exact authenticated 402/429 prefixes to influence routing. The result returns as text, the actual authentication route and optional fallback metadata; the adapter supplies the [public result metadata](design/web-tools.md).

The adapter does not inspect JSON-RPC or choose credentials. The renderer reads tool arguments, error text, and stable details; it does not parse Exa search results or read authentication state. MCP tool names and session mechanics remain private to the client.

## Connection and Cancellation

Extension loading performs no network I/O. Each route creates its MCP `Client` and Streamable HTTP transport only when needed; concurrent connects on that route share a promise. Failed initialization closes partial resources and clears cached state so a later call can reconnect. API-key initialization carries `x-api-key`; anonymous and OAuth requests never do. OAuth uses the SDK's minimal `AuthProvider` with Bearer tokens and `onInsufficientScope: "throw"`; it cannot discover, register or start interactive authorization.

Each `Client.callTool` receives the combined caller/lifecycle signal. Middleware also attaches the call's signal to tool HTTP because SDK 2.0.0's legacy protocol cancellation only sends a notification. A caller cancelled while awaiting shared initialization stops waiting without cancelling that connection. Retry delays observe the same call signal.

An HTTP 404 permits one fresh connection per route attempt only when the rejected tool request carried a server-issued session ID. Reconnection does not reset the anonymous probe or OAuth 401 budget. Retired connections stop accepting new calls and close after their existing users finish, so parallel responses can still be classified. Ambiguous transport failures are not automatically replayed.

`session_shutdown` invokes idempotent close. It immediately aborts active calls, login, retry waits, refresh, logout, lock acquisition and initialization, and rejects new work. Initialized route sessions terminate in parallel under one shared one-second grace, after which all clients and transports close even if termination fails or stalls. Termination requests are independent of the aborted operation signal. Termination uses the known token without starting refresh. Login closes its listener and temporary transports immediately on abort; it adds no termination grace. Login and OAuth transaction cleanup are awaited, and the login UI dismisses on settlement. Anonymous block state is cleared.

## Interactive Management

Only `/exa login` with `ctx.mode === "tui"` starts authorization. `hasUI` is insufficient because RPC also exposes UI methods. `ctx.ui.custom` holds a public Pi `BorderedLoader` and the URL; cancel keys and disposal abort the operation and clear the URL. Browser launch uses an argument array with `open`, `rundll32` or `xdg-open`, no shell, and discarded output. Failure leaves the transient URL available. Notices contain fixed messages; no management operation appends assistant messages or tool results.

Each login binds `127.0.0.1:0` before building its exact redirect URI. Its SDK `OAuthClientProvider` starts without saved tokens and holds SDK saves/invalidation in memory. Saved registration is reusable only for that redirect URI and the resolved issuer. The callback admits one GET on `/callback`, verifies state and unambiguous parameters before SDK `finishAuth`, and aborts on a detected duplicate. Callback responses report receipt, not successful persistence. Only an HTTPS authorization URL without username/password reaches the screen/browser.

The staged record passes the existing schema, then initializes a fresh Client/transport using a read-only minimal token provider. Successful SSE responses pass directly to the SDK so validation does not wait for EOF. The combined login signal also cancels the SDK initialization wait. Validation cannot refresh, register, start login or send tools; its connection never enters the route cache. The validation connection, completion transport and listener close before the OAuth commit lock is acquired. Expected revision protects against concurrent login/refresh/logout. Successful rename is not undone by a later abort. A successful login retires old normal OAuth connections through the same identity-aware mechanism as logout.

`getStatus` reads settings and OAuth without resolution, refresh, network, SQLite acquisition or file creation. It exposes only strategy, one of four local OAuth states, startup key presence and a local authentication candidate. Missing expiry is locally available; `loginRequired` and expired tokens without refresh capability require login. It provides no balance or remote-validity claim.

## Private State Foundation

`src/state-store.ts` uses Pi's `getAgentDir()` and canonicalizes the state directory. It has no cache or public path override. `src/state-schema.ts` validates records against version 1 and pinned SDK schemas. Settings use complete JSON replacement without SQLite. OAuth updates use `src/oauth-lock.ts`, with a connection per transaction, to reload the latest state and compare an optional expected revision before invoking the update callback. Returning `undefined` leaves JSON unchanged; credentials or `null` commit the next revision. SQLite rollback cannot undo JSON rename. Each logical call reads settings once before network access. Private client strategy operations back `/exa strategy`, use the lifecycle signal for writes and reject new work after close. Settings have no cache; successful rename is the commit point. `src/oauth-state.ts` reads the latest revision under the lock, reuses another process's usable credentials and retains ownership from remote refresh through rename. SDK failures become safe callback outcomes so storage or cleanup failures take precedence. Terminal refresh rejection commits `loginRequired`; transient failures leave credentials unchanged. The returned token is usable only after a successful commit. Private logout commits null credentials, then retires older local OAuth connections, including shared initialization with no remaining waiter. An initialization marked retired closes on completion without entering the route cache. See the [state contract](proposals/oauth-state.md#transactions-and-revisions).

## Packaging and Dependencies

[`package.json`](../../package.json) is authoritative for dependencies, runtimes, published files and the entry. PR2 raises the checkout's runtime floor to Node `>=24.15.0` under the [SQLite decision](decisions/sqlite-state-locking.md), without changing the package version before release.

The package-owned runtime dependency is exact-pinned `@modelcontextprotocol/client@2.0.0`, providing the MCP v2 client and Streamable HTTP transport. Pi supplies `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox` as peers with range `*`; concrete development versions support local checks. Any MCP server fixture dependency must remain development-only.

The manifest declares the `pi-package` keyword and a `pi.extensions` source entry, and defines no npm library export surface. Publication includes required TypeScript source, package metadata, README, and license. There is no generated `dist` artifact.

## Design Rationale

A single intent-level client keeps vendor protocol concerns out of Pi integration. These requirements need no generic provider interface, MCP adapter, dependency-injection container, or configuration subsystem. Private construction seams support deterministic tests. The executor returns the actual successful route directly. A private `AsyncLocalStorage` context carries the current SDK operation's HTTP evidence, signal, selected OAuth revision and tool-send/401 recovery budget; background notifications and SSE cannot overwrite that evidence. Provider storage/abort/refresh failures take precedence over an earlier HTTP 401; successful SDK replay clears preceding HTTP failure evidence. Package-owned errors in `src/errors.ts` replace upstream exceptions before they reach Pi.

Authentication resolution reads saved OAuth only when needed: usable OAuth, refreshable OAuth, API key, then unavailable. Each cached OAuth use rereads the revision; a changed revision retires the old connection by identity, leaving sent requests to finish before closure. Initialization belongs to the extension lifetime. Tools carry caller/lifecycle cancellation through refresh and HTTP. Credential alternatives are allowed only for OAuth authentication or refresh-network failure before a tool send; afterward a single same-route 401 recovery is the only authorization replay.

Runtime `listTools()` validation is omitted. Missing or renamed upstream tools surface as MCP tool errors, while bounded release smoke tests detect drift without adding discovery latency to every user's first call. The tool contract uses the common supported inputs and omits vendor defaults because the reviewed Hosted documentation and Exa source differed on some optional inputs and defaults.
