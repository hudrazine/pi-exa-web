# Anonymous and Authenticated Routing

The checkout implements saved routing strategies, bounded anonymous probes/cooldown and credit fallback for the next release. Merged PR4 adds non-interactive OAuth selection and refresh; local PR5 adds [interactive management](../proposals/oauth-routing.md#pi-contract-and-management). The key is read once at extension initialization, trimmed, and never persisted.

## Selection and Settings

Each logical search/fetch reads settings once before any network request and retains that strategy throughout every attempt. Missing settings mean `anonymous-first`; malformed or unreadable settings fail with `storage`. Another process's successful setting change takes effect on the next call.

`anonymous-first` starts anonymously unless a cooldown is active and usable authentication exists. `authenticated-first` resolves authentication first, otherwise anonymous. Resolution prefers usable OAuth, refreshable OAuth, then the startup API key. `loginRequired` takes precedence over expiry; expired credentials without a refresh token are unavailable. Missing expiry is locally usable until a server 401. Anonymous primary success does not read OAuth. Selecting authentication directly during cooldown is primary selection, not fallback. The single `/exa` command supports login, logout, local status and strategy display/replacement; [the README](../../../README.md#authentication-and-rate-limits) describes its usage. Mutating commands notify success only after successful storage replacement. Invalid arguments do not write state. Login starts only in local TUI; status never invokes authentication resolution or refresh.

The intent-level policy selects routes outside `Client.callTool`. Middleware observes HTTP responses and applies connection credentials. API-key requests, including initialization, carry `x-api-key`; anonymous and OAuth requests and URLs never contain the key. OAuth uses SDK Bearer authentication on its dedicated endpoint. Each route uses a separate lazy connection. Tool names and arguments stay the same across attempts; JSON-RPC IDs and bodies may differ.

## Anonymous Probe and Cooldown

Only HTTP 429 on anonymous `tools/call` triggers this handling; initialization failures and anonymous MCP error text do not authorize replay.

| Condition | Behavior |
| --- | --- |
| First 429 has a usable deadline at most 2,000 ms away | Wait until it, observing cancellation, and probe anonymous once |
| First 429 has no usable headers | Wait 1,000 ms and probe anonymous once |
| First deadline exceeds 2,000 ms | Skip both wait and probe |
| Probe returns another 429, or long probe was skipped | Use one available authenticated fallback if unused; otherwise return the final anonymous limit |
| Active cooldown with authentication | Select authentication as primary under anonymous-first |
| No usable authentication, including during cooldown | Attempt anonymous under the same probe limit |

Parse `Retry-After` first as non-negative seconds or an HTTP date, then `X-RateLimit-Reset` as epoch seconds/milliseconds when the first header is unusable. Clamp past deadlines to now and ignore malformed/non-finite values. A second 429 supplies the final limit information. Only usable headers supply `retryAt`; the private default wait does not.

Set cooldown when taking a rate-limit fallback: until the final header deadline, or 1,000 ms after observing the final no-header 429. Authentication resolution, initialization and response time do not extend it. Concurrent failures keep the later active/new deadline. Anonymous success clears it. There is no failure counter, exponential backoff, probe generation, persistent quota state or cross-process scheduler. Close clears the process-local deadline.

## Authenticated Errors and Replay Budget

Inside each route attempt, classify `isError: true` only when the first text block starts with the invoked upstream tool's exact ` error (402):` or ` error (429):` prefix on OAuth or the API-key route. A 402 becomes `credits-exhausted` and permits an unused anonymous fallback; a 429 becomes terminal `authenticated-rate-limit` without a retry time. The remainder is discarded. The [accepted classifier boundary](../proposals/oauth-routing.md#authenticated-tool-error-boundary) defines near misses, including raw HTTP 402, which remains `transport` without fallback.

One logical call has one primary and at most one fallback. Anonymous → authenticated → 402 stops. Authenticated → anonymous → 429 may probe once but cannot return to authentication. An authenticated primary selected during cooldown may fall back anonymously on 402. No authenticated credit cooldown or balance lookup is added.

The actual successful route and optional `{from, to, reason}` return with the result; parallel calls do not share last-route metadata. Only the final route's failure code/retry time reaches Pi. Permission, MCP network/server, other tool, storage and abort failures do not authorize fallback. Before any OAuth tool HTTP send, OAuth authentication or refresh-network failure may select the API key or anonymous primary. This is credential selection, not a fallback hop. After an OAuth tool send, 401 can refresh or reuse a newer committed revision and replay on OAuth once; repeated 401, refresh failure or 403 cannot switch credentials. Challenges cannot change the stored issuer/resource or start login.

The [architecture](../architecture.md) owns cancellation, connection lifetime and the separate one-time recovery for a session-bearing HTTP 404. Reconnection never resets the logical call's one anonymous probe, OAuth 401 recovery or fallback limit. [Quality criteria](../quality.md) identify the tests.
