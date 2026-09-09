# Anonymous-first Authentication

The current policy, including unreleased PR1 changes over `0.1.0`, starts tool calls anonymously and uses `EXA_API_KEY` only after an anonymous rate limit. The key is read once at extension initialization, trimmed, and never persisted. This contract does not include the [accepted, unimplemented OAuth strategies](../proposals/oauth-routing.md).

## Eligible Requests and Credentials

The intent-level policy selects a route outside `Client.callTool`. Transport middleware observes HTTP responses and applies that connection's credentials. Only HTTP 429 on an anonymous `tools/call` triggers the policy's retry or fallback; initialization failures and MCP error text do not authorize fallback.

Authenticated calls execute the same tool name and arguments on a separate API-key connection. Its requests, including initialization, carry `x-api-key`; anonymous requests and URLs never contain the key. The executor returns the actual successful route even under concurrency. JSON-RPC IDs and serialized bodies may differ between attempts.

## Block State and Retry

The policy stores one anonymous block deadline in process memory. Credential presence is configuration. It maintains no persistent quota state or cross-process scheduler.

| Condition | Behavior |
| --- | --- |
| No active block | Send anonymously |
| Anonymous response is not HTTP 429 | Return the response without policy retry |
| First anonymous 429 has a usable deadline at most two seconds away | Wait until the deadline, observing cancellation, then retry anonymously once |
| Anonymous retry is not 429 | Return the retry response |
| Deadline is longer than two seconds, absent, or unusable; or retry is 429 | Set the block deadline from the final 429 and use the API key once, if available |
| Block is active | Use the API key directly; without a key, fail locally without a network request |
| Block has expired | Clear it and try anonymously again |

For each 429, parse `Retry-After` first as non-negative seconds or an HTTP date. If unusable, accept `X-RateLimit-Reset` as epoch seconds or milliseconds. Past dates are clamped to now. If neither header is usable, block for one second; do not perform a no-header anonymous probe. That short default prevents a hot retry loop without hiding anonymous availability for long.

A second anonymous 429 supplies the final block deadline. Only usable headers supply an error's `retryAt`; the private one-second default is not an upstream retry time. Missing API-key configuration produces the [tool error](web-tools.md#errors-and-secret-handling). Parallel callers may independently observe an initial 429 and fall back; the package does not schedule hosted QPS limits.

## Replay Boundary

The API-key result is final. Authenticated 429, MCP tool error, network failure, and server failure neither return to anonymous nor start a retry cycle. Automatic policy replay is limited to anonymous HTTP 429 because the reviewed Exa handler returns it before dispatching the tool. Ambiguous transport failures may follow execution and are not replay-safe.

The [architecture](../architecture.md) owns per-route connection lifetime, cancellation, and the separate one-time recovery for a session-bearing HTTP 404. [`src/anonymous-first.ts`](../../../src/anonymous-first.ts) implements this policy; [quality criteria](../quality.md) identify its deterministic checks.
