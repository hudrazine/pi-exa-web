# v0.2.0 OAuth and Routing Design

**Status:** Accepted for `0.2.0`; PR1–PR5 merged with CI verified; Hosted smoke and release verification pending **Target:** `@hudrazine/pi-exa-web@0.2.0`

This document defines the behavior and source-backed rationale accepted on 2026-09-09. The [implementation plan](../plans/oauth-routing.md) owns delivery; the [verification specification](../plans/oauth-verification.md) owns acceptance checks. The [current architecture](../architecture.md) describes the checkout, including merged, unreleased PR1–PR5 changes over `0.1.0`. The accepted [OAuth state design](oauth-state.md) defines implemented login, refresh and persistence, using the private [SQLite coordination foundation](../decisions/sqlite-state-locking.md).

## Purpose and Scope

Let Pi users keep anonymous access as the default, sign in to Exa explicitly, and choose whether anonymous or authenticated access is preferred. Keep authentication and routing inside private Pi Package modules.

Retain one package, the TypeScript extension entry, and source-only distribution. Raise the Node.js minimum to `>=24.15.0` for the accepted release-candidate `node:sqlite` API. Do not introduce a public SDK, additional workspace packages, adapters for other hosts, a stdio MCP server, generic providers, custom storage backends, or a new build step. Multiple accounts, OS keychains, remote OAuth callback relays, network-filesystem persistence, arbitrary routing graphs, and configurable retry policies are outside this version.

The supported strategy names are `anonymous-first` and `authenticated-first`. Anonymous-first favors account-credit conservation and may wait briefly; it does not promise the shortest latency.

## Pi Contract and Management

Preserve `web_search(query, numResults?)` and `web_fetch(url, maxCharacters?)`, including the [current bounds, single-URL fetch input, optional-argument omission, and successful Exa text](../design/web-tools.md#inputs-and-results). MCP types and internal interfaces remain private.

Keep successful `details.provider`, `operation`, `auth`, and existing argument metadata. Extend `auth` to `anonymous | oauth | api-key`. An optional `fallback` detail contains only `from`, `to`, and `reason` (`anonymous-rate-limit | credits-exhausted`). Selecting authenticated access directly during anonymous cooldown is not a fallback. Display the effective route in the collapsed result and a fallback reason when expanded. Do not add routing prose to successful LLM-facing content or parse Exa's text for metadata.

Register one `/exa` command with these subcommands; none is an LLM-callable tool:

| Command | Behavior |
| --- | --- |
| `/exa login` | Start explicit OAuth; show the authorization URL in Pi UI and attempt browser opening where supported. Failure to open the browser leaves the displayed URL usable. |
| `/exa logout` | Remove local OAuth credentials and invalidate the local OAuth connection. Leave `EXA_API_KEY` and strategy intact. |
| `/exa status` | Read local state without network access; show strategy, OAuth state, API-key presence, and locally selectable authenticated route. Do not claim to know account credits or remote token validity. |
| `/exa strategy` | Show the saved/effective strategy. |
| `/exa strategy anonymous-first` or `authenticated-first` | Validate and persist the strategy before reporting success. Invalid arguments do not change state. |

Use `ctx.ui.custom` for the temporary authorization URL and waiting screen; do not use assistant messages, tool results or persistent entries. Start login only for `ctx.mode === "tui"`; `hasUI` also covers RPC and is not the gate. Other modes give local-interactive-Pi guidance using the same agent directory, without a listener, browser or authorization request. The URL must be HTTPS without username/password. Connect Pi's cancel key and screen disposal to the login signal and remove the URL on completion. Open it best effort with `open`, `rundll32` or `xdg-open`, argument arrays, no shell and discarded output; do not import Pi's private browser helper. Notify success, timeout, cancellation, denial and conflict with fixed messages. Previously saved credentials and non-interactive refresh work in other modes. Remote/headless login and automatic SSH forwarding are not part of this version. A failed re-login must not destroy an existing working login.

Login/logout/status accept no arguments. Strategy accepts zero or one supported value. Unknown commands, invalid values and extra arguments show fixed usage without saving or echoing input. Status reads settings and OAuth only, with no refresh, connection, SQLite acquisition or file creation. `loginRequired` takes precedence; expired credentials without a refresh token need login, and missing expiry is locally available.

Read `EXA_API_KEY` once at extension initialization and trim it. Do not persist it or add a strategy environment variable. Resolve strategy from saved settings, then `anonymous-first`. Read settings at each logical call boundary so another Pi process's successful change applies to subsequent calls. Snapshot strategy for the entire call; a concurrent command does not change an in-flight route plan. A missing state directory means defaults and no OAuth credentials, and read-only operations do not create it.

## Private Responsibilities

Retain the existing Pi tool registration and rendering boundary. Extend the private client with management operations as needed; do not make that interface a supported import surface.

| Responsibility | Ownership |
| --- | --- |
| Extension entry and commands | Read Pi environment/directory, register tools and `/exa`, translate UI and cancellation, close on shutdown. |
| Tool registration and renderer | Preserve tool schemas and text contract; add safe OAuth/fallback display. |
| Route executor | Own strategy snapshots, authenticated-route resolution, attempt budgets, cooldown, and fallback. |
| MCP connection management | Map the two tool calls; maintain one lazy connection per route; observe raw HTTP responses and return classified results. |
| OAuth and state management | Compose SDK OAuth, callback lifecycle, revisioned storage, transactions, and directory-scoped concurrency. |

The reviewed SDK baseline is MCP client `2.0.0`. Relevant OAuth/lifecycle fixtures must be revalidated on SDK upgrades. Runtime dependencies remain private; a matching MCP server may be exact-pinned for development fixtures only. Locking uses Node's bundled SQLite under the [lock contract](../design/oauth-state-locking.md). Use the SDK for OAuth rather than implementing the protocol.

The executor switches routes around `Client.callTool`. Middleware supplies route-specific credentials and observes status/headers. This lets the executor inspect MCP `isError` results before text conversion. Return the route from the actual attempt, avoiding shared mutable last-route state. This private boundary does not require a generic router.

## Routes and Selection

| Route | Endpoint | Credential |
| --- | --- | --- |
| `anonymous` | `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa` | None |
| `api-key` | Same endpoint as anonymous, separate connection | `x-api-key` |
| `oauth` | `https://mcp.exa.ai/mcp/oauth` (no query) | SDK-managed Bearer token |

OAuth and API-key credentials must never appear on the same request. Credentials belong to their route connection, including connection initialization as required by the server. Never attach credentials through a global fetch wrapper or put the API key in a URL. Do not try an alternate endpoint after failure.

**Endpoint basis:** Exa's [OAuth handler][exa-oauth] configures `/mcp/oauth`. Its [request handler][exa-handler] rejects missing/invalid credentials before tool execution and gives `x-api-key` precedence over Bearer authentication, supporting separate credential connections. [Resource metadata][exa-metadata] and [JWT validation][exa-jwt] establish issuer/resource binding. Actual registration, consent, and refresh-token issuance require the [Hosted release smoke](../plans/oauth-verification.md#hosted-oauth-release-smoke).

### Authenticated Credential Resolution

Resolve authenticated access when the selected strategy needs it, in this order: valid saved OAuth, refreshable OAuth after non-interactive refresh, API key, unavailable. Do not refresh OAuth merely to serve a successful anonymous primary request. Explicit login takes precedence over an environment key; there is no configurable OAuth-versus-key preference.

An OAuth refresh authentication or network failure before any tool request may make OAuth unavailable for that selection and allow the API key. If neither route is usable, use anonymous when it is the primary or an allowed fallback. Abort, state corruption, lock timeout, storage conflict, and storage write failure are not permission to silently choose another credential. They fail the operation. A terminal OAuth refresh rejection marks that credential revision as requiring login; retain the record for explicit login/logout and do not repeatedly refresh it. A transient network failure does not permanently invalidate the stored credential and may be retried on a later logical call.

A 401 after an OAuth tool request may trigger one SDK-managed non-interactive refresh and retry on OAuth. If it still fails, or refresh fails at that point, the request fails without API-key or anonymous fallback. A 403 never selects a different route. Configure `onInsufficientScope: "throw"` and use the [non-interactive runtime composition](oauth-state.md#oauth-lifecycle); ordinary calls have no authorization-URL callback.

## Strategy and Retry Contract

Each logical tool call allows one primary route and at most one fallback. Internal same-route retries do not add fallback steps. OAuth and API key are alternative authenticated selections, not two sequential fallback targets.

| Primary outcome | Same-route handling | Cross-route handling |
| --- | --- | --- |
| Anonymous success | Return result | None |
| Anonymous tool-call HTTP 429 | Bounded probe below | Resolved authenticated route, if available and fallback unused |
| Authenticated success | Return result | None |
| Authenticated classified 402 | None | Anonymous, if fallback unused |
| Authenticated HTTP or classified tool-result 429 | None | None |
| OAuth tool-call 401 | At most one non-interactive SDK refresh/retry | None |
| Protocol-defined expired-session 404 | One fresh connection/retry on that route | None |
| Other error or abort | None | None |

`anonymous-first` chooses anonymous unless its cooldown is active and a usable authenticated route is available. `authenticated-first` chooses the resolved authenticated route, or anonymous if unavailable. Classified 402 on an authenticated primary permits anonymous fallback even during anonymous cooldown. This also applies when anonymous-first selected an authenticated primary during cooldown. An anonymous-to-authenticated fallback that then receives 402 is final: it cannot return to anonymous. An authenticated-to-anonymous fallback that receives 429 may use the bounded anonymous probe, but cannot return to authentication.

### Anonymous Probe and Cooldown

Use these accepted private policy constants; they express package policy, not Exa quota values:

| Setting                            | Value    |
| ---------------------------------- | -------- |
| Maximum anonymous probe delay      | 2,000 ms |
| Probe delay without usable headers | 1,000 ms |
| Cooldown without usable headers    | 1,000 ms |

For anonymous tools/call HTTP 429, parse `Retry-After` (non-negative seconds or HTTP date), then `X-RateLimit-Reset` (epoch seconds or milliseconds). Clamp past deadlines to now. Ignore malformed/non-finite values. `retryAt` is epoch milliseconds and exists only when a header supplies usable evidence; a private default delay is not an upstream retry time.

If the first delay is at most 2,000 ms, wait and retry anonymous once. If it exceeds that limit, skip the wait and probe. Without usable headers, wait 1,000 ms and retry once. A second 429 or skipped long probe permits authenticated fallback. With no authenticated alternative, return `anonymous-rate-limit` after the same bounded handling.

After a rate-limit fallback, suppress anonymous primary selection until the last 429's header deadline, or until 1,000 ms after observing that final 429 when no usable deadline exists. Repeated no-header failures use the same fixed duration; do not keep an exponent, failure count, or probe generation. Concurrent requests may fail independently; update the single cooldown deadline synchronously using the later of the active deadline and the new deadline. Anonymous success clears cooldown. No quota scheduler or shared cooldown is introduced. Without a usable authenticated alternative, attempt anonymous despite cooldown. Cooldown disappears when the extension closes.

The fixed no-header policy retains one bounded chance to avoid account-credit use without a backoff state machine. Missing headers provide no evidence of a longer upstream retry time. This simplicity can cause more anonymous attempts during a persistent no-header limit than exponential backoff; accept that tradeoff. Header-derived deadlines and the one-probe/one-fallback limits remain unchanged.

No authenticated-credit cooldown or balance discovery is added: authenticated-first may receive a fresh 402 on each later call until the account state changes.

## Failure Classification and Safe Output

Classify evidence before constructing Pi errors or applying routing. Internal failures use `anonymous-rate-limit`, `authenticated-rate-limit`, `credits-exhausted`, `authentication`, `permission`, `transport`, `server`, or `tool`; local failures use `storage`, `storage-conflict`, or `lifecycle`. Explicit login also uses fixed `login-in-progress`, `login-timeout`, `login-denied` and `login-cancelled` messages through command notifications. Keep only the final route failure as the top-level code and retry time. Earlier failed routes may be retained in private sanitized attempt metadata, not raw exceptions.

| Evidence | Classification and consequence |
| --- | --- |
| Raw HTTP 429 for anonymous tools/call | `anonymous-rate-limit`; bounded probe and permitted fallback |
| Raw HTTP 429 on authenticated route | `authenticated-rate-limit`; optional header-derived retry time, no automatic replay |
| Exact authenticated tool-result 402 boundary below | `credits-exhausted`; permitted anonymous fallback |
| Exact authenticated tool-result 429 boundary below | `authenticated-rate-limit`; no retry time or automatic replay |
| Final transport HTTP 401 / 403 | `authentication` / `permission`; no fallback |
| Transport HTTP 5xx | `server`; no replay |
| Network error or ambiguous response | `transport`; no replay |
| Other MCP `isError`, unexpected/non-text result, or unmatched error text | Sanitized `tool` error; no routing inference |
| Malformed/unsupported state or storage failure | Local `storage`; no credential fallback |
| Concurrent login commit revision change | `storage-conflict`; preserve newer state |
| Abort | Preserve original reason internally; existing Pi cancellation presentation; no replay |

### Authenticated Tool-error Boundary

The authenticated compatibility classifiers require all of:

1. Effective route is `oauth` or `api-key`.
2. MCP result has `isError: true`.
3. Invoked upstream tool is exactly `web_search_exa` or `web_fetch_exa`.
4. The first text block starts exactly with that invoked name followed by ` error (402):` or ` error (429):`.

Do not trim leading text, scan later blocks, accept the other tool's name, match embedded status numbers/tags, or parse natural-language credit/rate-limit messages. The anonymous free-tier natural-language tool error is not the anonymous HTTP gate and does not authorize replay. A raw authenticated HTTP 402 is not covered by the tool-result compatibility rule; treat it as an unclassified failure without fallback until source-backed behavior is established. Only the 402 text prefix permits cross-route fallback; the 429 prefix classifies a terminal failure. Exact-prefix matching does not make the remainder safe to display.

**Classifier basis:** Exa's [request handler][exa-handler] returns anonymous HTTP 429 before dispatch. Its [error formatter][exa-errors], used by [search][exa-search] and [fetch][exa-fetch], produces the authenticated prefixes above and a separate anonymous natural-language error. [exa-js][exa-js] preserves HTTP status but not error tags; [Exa's error reference][exa-status] associates 402 with account/team budget exhaustion. These boundaries justify the narrow routing classifiers.

### Safe Output

Build error messages from package-owned templates and allowlisted metadata. Missing authentication after an anonymous limit can suggest `/exa login`, `EXA_API_KEY`, or retrying later. Errors, details, logs, and persisted conversation records must not expose raw causes, headers, response bodies, token values, authorization codes/URLs, or credential-bearing URLs. The explicit login command displays its authorization URL only in transient Pi UI. Use redaction only as a secondary measure. Successful search/fetch content retains the existing contract; terminal sanitization is separate from failure sanitization.

## Connection and Cancellation

Extension loading performs no network I/O. Initialize connections lazily per route, deduplicate concurrent connects on that route, and close partial resources on failure. Preserve independent cancellation of a caller waiting for a shared connection: cancelling one waiter must not close a connection needed by another. Shared initialization belongs to the extension lifecycle; per-call HTTP, refresh/lock waits, and retry delays observe the caller's signal.

Under the [MCP session contract][mcp-session], retry expired-session 404 once on a fresh client/transport only when the rejected request carried a server-issued MCP session ID. Do not infer expiry from arbitrary tool text or a non-session 404. Limit session recovery to once per route attempt, anonymous 429 probing to once per logical call, and OAuth 401 recovery to once per OAuth attempt; reconnecting must not reset those counters or create combined retry loops. No implicit tool-network timeout or general retry middleware is introduced.

`close()` is idempotent, stops accepting new work, aborts active calls/login/lock waits, and closes all connections and callback listeners. Use a one-second best-effort session-termination grace across initialized connections in parallel. Locks release through operation cleanup under the [state transaction contract](oauth-state.md#transactions-and-revisions).

[exa-oauth]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/api/mcp-oauth.ts
[exa-handler]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/api/mcp.ts
[exa-metadata]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/api/well-known-oauth-protected-resource.ts
[exa-jwt]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/src/utils/auth.ts
[exa-errors]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/src/utils/errorHandler.ts
[exa-search]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/src/tools/webSearch.ts
[exa-fetch]: https://github.com/exa-labs/exa-mcp-server/blob/15ffb50519e719dc791cdc750ce5ed1934c0a1ed/src/tools/webFetch.ts
[exa-js]: https://github.com/exa-labs/exa-js/blob/c2224ee996422fd41e79804c822635d05eb064af/src/index.ts
[exa-status]: https://exa.ai/docs/reference/error-codes
[mcp-session]: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#session-management
