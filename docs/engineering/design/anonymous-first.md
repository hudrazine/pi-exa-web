# Anonymous and API-key Routing

The checkout implements saved routing strategies, bounded anonymous probes/cooldown and credit fallback for the next release. OAuth selection remains [accepted, unimplemented work](../proposals/oauth-routing.md). The key is read once at extension initialization, trimmed, and never persisted.

## Selection and Settings

Each logical search/fetch reads settings once before any network request and retains that strategy throughout every attempt. Missing settings mean `anonymous-first`; malformed or unreadable settings fail with `storage`. Another process's successful setting change takes effect on the next call.

`anonymous-first` starts anonymously unless a cooldown is active and an API key is configured. `authenticated-first` starts with the configured API key, otherwise anonymous. Selecting the key directly during cooldown is primary selection, not fallback. The single `/exa` command supports strategy display and replacement; [the README](../../../README.md#authentication-and-rate-limits) describes its usage. Commands notify through Pi UI only after successful storage replacement. Invalid arguments do not write state.

The intent-level policy selects routes outside `Client.callTool`. Middleware observes HTTP responses and applies connection credentials. Authenticated requests, including initialization, carry `x-api-key`; anonymous requests and URLs never contain the key. Each route uses a separate lazy connection. Tool names and arguments stay the same across attempts; JSON-RPC IDs and bodies may differ.

## Anonymous Probe and Cooldown

Only HTTP 429 on anonymous `tools/call` triggers this handling; initialization failures and anonymous MCP error text do not authorize replay.

| Condition | Behavior |
| --- | --- |
| First 429 has a usable deadline at most 2,000 ms away | Wait until it, observing cancellation, and probe anonymous once |
| First 429 has no usable headers | Wait 1,000 ms and probe anonymous once |
| First deadline exceeds 2,000 ms | Skip both wait and probe |
| Probe returns another 429, or long probe was skipped | Use one available API-key fallback if unused; otherwise return the final anonymous limit |
| Active cooldown with a key | Select the key as primary under anonymous-first |
| No key, including during cooldown | Attempt anonymous under the same probe limit |

Parse `Retry-After` first as non-negative seconds or an HTTP date, then `X-RateLimit-Reset` as epoch seconds/milliseconds when the first header is unusable. Clamp past deadlines to now and ignore malformed/non-finite values. A second 429 supplies the final limit information. Only usable headers supply `retryAt`; the private default wait does not.

Set cooldown when taking a rate-limit fallback: until the final header deadline, or 1,000 ms after observing the final no-header 429. Key initialization and response time do not extend it. Concurrent failures keep the later active/new deadline. Anonymous success clears it. There is no failure counter, exponential backoff, probe generation, persistent quota state or cross-process scheduler. Close clears the process-local deadline.

## Authenticated Errors and Replay Budget

Inside each route attempt, classify `isError: true` only when the first text block starts with the invoked upstream tool's exact ` error (402):` or ` error (429):` prefix on the API-key route. A 402 becomes `credits-exhausted` and permits an unused anonymous fallback; a 429 becomes terminal `authenticated-rate-limit` without a retry time. The remainder is discarded. The [accepted classifier boundary](../proposals/oauth-routing.md#authenticated-tool-error-boundary) defines near misses, including raw HTTP 402, which remains `transport` without fallback.

One logical call has one primary and at most one fallback. Anonymous → key → 402 stops. Key → anonymous → 429 may probe once but cannot return to the key. A key primary selected during cooldown may fall back anonymously on 402. No authenticated credit cooldown or balance lookup is added.

The actual successful route and optional `{from, to, reason}` return with the result; parallel calls do not share last-route metadata. Only the final route's failure code/retry time reaches Pi. Authentication/permission, network/server, other tool, storage and abort failures do not authorize fallback.

The [architecture](../architecture.md) owns cancellation, connection lifetime and the separate one-time recovery for a session-bearing HTTP 404. Reconnection never resets the logical call's one anonymous probe or fallback limit. [Quality criteria](../quality.md) identify the tests.
