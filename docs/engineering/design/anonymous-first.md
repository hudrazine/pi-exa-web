# Authentication and Routing

This contract defines route selection and bounded replay for both web tools. It favors anonymous access by default while allowing explicit authenticated-first selection. [OAuth state](oauth-state.md) owns credential transactions; [management](management.md) owns commands; [architecture](../architecture.md#connection-and-cancellation) owns connection lifetime.

Each logical call reads settings before network access and keeps that strategy through initialization, probes, reconnection and fallback. Missing settings mean `anonymous-first`; unreadable or invalid settings fail safely. A successful external settings replacement affects the next call. The API key is read and trimmed once at extension startup and is never persisted.

## Routes and Selection

| Route | Endpoint | Credential |
| --- | --- | --- |
| `anonymous` | `https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa` | None |
| `api-key` | Same endpoint as anonymous, separate connection | `x-api-key` |
| `oauth` | `https://mcp.exa.ai/mcp/oauth` (no query) | SDK-managed Bearer token |

OAuth and API-key credentials must never appear on the same request. Credentials belong to their route connection, including connection initialization as required by the server. Never attach credentials through a global fetch wrapper or put the API key in a URL. Do not try an alternate endpoint after failure.

**Endpoint basis:** Exa's [OAuth handler][exa-oauth] configures `/mcp/oauth`. Its [request handler][exa-handler] rejects missing/invalid credentials before tool execution and gives `x-api-key` precedence over Bearer authentication, supporting separate credential connections. [Resource metadata][exa-metadata] and [JWT validation][exa-jwt] establish issuer/resource binding. Actual registration, consent, and refresh-token issuance require the [Hosted release smoke](../releases.md#hosted-oauth-smoke).

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
| [MCP expired-session 404][mcp-session] | One fresh connection/retry on that route | None |
| Other error or abort | None | None |

`anonymous-first` chooses anonymous unless its cooldown is active and a usable authenticated route is available. `authenticated-first` chooses the resolved authenticated route, or anonymous if unavailable. Classified 402 on an authenticated primary permits anonymous fallback even during anonymous cooldown. This also applies when anonymous-first selected an authenticated primary during cooldown. An anonymous-to-authenticated fallback that then receives 402 is final: it cannot return to anonymous. An authenticated-to-anonymous fallback that receives 429 may use the bounded anonymous probe, but cannot return to authentication.

### Anonymous Probe and Cooldown

Use these private policy constants; they express package policy, not Exa quota values:

| Setting                            | Value    |
| ---------------------------------- | -------- |
| Maximum anonymous probe delay      | 2,000 ms |
| Probe delay without usable headers | 1,000 ms |
| Cooldown without usable headers    | 1,000 ms |

For anonymous tools/call HTTP 429, parse `Retry-After` (non-negative seconds or HTTP date), then `X-RateLimit-Reset` (epoch seconds or milliseconds). Clamp past deadlines to now. Ignore malformed/non-finite values. `retryAt` is epoch milliseconds and exists only when a header supplies usable evidence; a private default delay is not an upstream retry time.

If the first delay is at most 2,000 ms, wait and retry anonymous once. If it exceeds that limit, skip the wait and probe. Without usable headers, wait 1,000 ms and retry once. A second 429 or skipped long probe permits authenticated fallback. With no authenticated alternative, return `anonymous-rate-limit` after the same bounded handling.

When taking a rate-limit fallback, suppress anonymous primary selection until the last 429's header deadline, or until 1,000 ms after observing that final 429 when no usable deadline exists. Authentication resolution, initialization and response time do not extend that deadline. Repeated no-header failures use the same fixed duration; do not keep an exponent, failure count, or probe generation. Concurrent requests may fail independently; update the single cooldown deadline synchronously using the later of the active deadline and the new deadline. Anonymous success clears cooldown. No quota scheduler or shared cooldown is introduced. Without a usable authenticated alternative, attempt anonymous despite cooldown. Cooldown disappears when the extension closes.

The fixed no-header policy retains one bounded chance to avoid account-credit use without a backoff state machine. Missing headers provide no evidence of a longer upstream retry time. This simplicity can cause more anonymous attempts during a persistent no-header limit than exponential backoff; accept that tradeoff. Header-derived deadlines and the one-probe/one-fallback limits remain unchanged.

No authenticated-credit cooldown or balance discovery is added: authenticated-first may receive a fresh 402 on each later call until the account state changes.

### Authenticated Tool-error Boundary

The authenticated compatibility classifiers require all of:

1. Effective route is `oauth` or `api-key`.
2. MCP result has `isError: true`.
3. Invoked upstream tool is exactly `web_search_exa` or `web_fetch_exa`.
4. The first text block starts exactly with that invoked name followed by ` error (402):` or ` error (429):`.

Do not trim leading text, scan later blocks, accept the other tool's name, match embedded status numbers/tags, or parse natural-language credit/rate-limit messages. The anonymous free-tier natural-language tool error is not the anonymous HTTP gate and does not authorize replay. A raw authenticated HTTP 402 is not covered by the tool-result compatibility rule; classify it as `transport` without fallback. Only the 402 text prefix permits cross-route fallback; the 429 prefix classifies a terminal failure. Exact-prefix matching does not make the remainder safe to display.

**Classifier basis:** Exa's [request handler][exa-handler] returns anonymous HTTP 429 before dispatch. Its [error formatter][exa-errors], used by [search][exa-search] and [fetch][exa-fetch], produces the authenticated prefixes above and a separate anonymous natural-language error. [exa-js][exa-js] preserves HTTP status but not error tags; [Exa's error reference][exa-status] associates 402 with account/team budget exhaustion. These boundaries justify the narrow routing classifiers.

## Failure and Lifecycle Boundaries

The [tool error contract](web-tools.md#errors-and-secret-handling) defines all safe failure codes and their evidence. Only the final route's failure code and header-derived retry time reach Pi. Earlier failed routes never supply the final retry time.

Only anonymous tool-call HTTP 429 starts a probe; initialization 429 and anonymous MCP error text do not. Each route uses a separate lazy connection; credentials apply to initialization as well as tool calls. The [connection contract](../architecture.md#connection-and-cancellation) permits one session-bearing 404 recovery per route attempt without resetting anonymous probe, OAuth 401 or fallback budgets. There is no implicit tool-network timeout or general retry middleware.

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
