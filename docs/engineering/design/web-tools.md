# Pi Tool Contract

The current extension registers `web_search` and `web_fetch`. They expose Exa search and single-page text retrieval through Pi; MCP types and internal modules are not public APIs. Authentication is defined by the [anonymous-first policy](anonymous-first.md).

## Inputs and Results

| Tool | Required input | Optional input | Upstream mapping |
| --- | --- | --- | --- |
| `web_search` | `query: string` | `numResults: integer`, 1–20 | `web_search_exa` with the same fields |
| `web_fetch` | `url: string` | `maxCharacters: integer`, 1–20,000 | `web_fetch_exa` with `urls: [url]` and the optional limit |

Pi validates the TypeBox schemas before execution. Optional values are omitted from the MCP call when absent so Exa owns its defaults.

The client collects MCP text blocks in order, joining them with blank lines. It does not parse search results or introduce a package-owned response schema. A successful MCP response without text is an error. MCP `isError: true` is classified inside the route attempt and never returned as successful content. A permitted fallback may still make the logical call succeed.

Successful Pi results contain text plus stable `details`:

| Field | Meaning |
| --- | --- |
| `provider` | Always `exa` |
| `operation` | `search` or `fetch` |
| `auth` | Actual successful route: `anonymous`, `oauth` or `api-key` |
| `fallback` | Optional `{from, to, reason}`: `anonymous-rate-limit` or `credits-exhausted`; absent for primary selection during cooldown |
| `query`, `requestedNumResults` | Search input and optional requested count |
| `url`, `maxCharacters` | Fetch input and optional requested limit |

Only the fields for the invoked operation are present, and omitted limits remain absent. Requested counts must not be presented as actual returned counts. Details contain neither credentials nor HTTP headers nor raw protocol data.

## Pi Presentation

The standard Pi tool shell owns pending, success, and error framing. Calls show the query or URL, requested limits, and progress while executing. Collapsed results show completion and the successful authentication route; expanded results show Exa text and, when present, a fixed fallback route/reason. Routing prose is never added to successful model-facing text. Display normalization removes terminal sequences and normalizes line endings without changing successful model-facing text.

Errors show a concise collapsed summary and expanded error text. Cancellation is normalized to `Cancelled`. The renderer uses arguments and result details; it does not infer metadata from Exa text or consult the authentication policy.

## Errors and Secret Handling

MCP tool errors, SDK failures, and network failures are thrown so Pi marks the call as failed. Missing credentials after an anonymous limit produce a package-owned message suggesting `/exa login`, naming `EXA_API_KEY`, linking to the Exa key dashboard, and suggesting retry later. Cancellation and connection cleanup follow the [lifecycle contract](../architecture.md#connection-and-cancellation).

Failures use package-owned messages and private failure codes: `anonymous-rate-limit`, `authenticated-rate-limit`, `credits-exhausted`, `authentication`, `permission`, `server`, `transport`, `tool`, `storage`, `storage-conflict`, and `lifecycle`. Errors retain only the final failure and an optional header-derived `retryAt` in epoch milliseconds. HTTP observation supplies status evidence; SDK protocol/invalid-result errors, MCP `isError` and non-text results become safe tool errors. Network and ambiguous communication failures use `transport`. The failure codes have these evidence boundaries:

| Evidence | Code |
| --- | --- |
| Anonymous / authenticated HTTP 429 | `anonymous-rate-limit` / `authenticated-rate-limit` |
| Authenticated exact tool-result 402 / 429 prefix | `credits-exhausted` / `authenticated-rate-limit` |
| Final HTTP 401 / 403 | `authentication` / `permission` |
| HTTP 5xx | `server` |
| Network, ambiguous communication, raw HTTP 402 | `transport` |
| SDK protocol/invalid-result error, other MCP error or missing text | `tool` |
| Invalid, unreadable, unavailable or failed storage/cleanup | `storage` |
| Login expected-revision mismatch | `storage-conflict` |
| Operation after close | `lifecycle` |

The client classifies only the invoked tool's exact first-text-block 402/429 prefix on authenticated `isError: true` results; see the [routing boundary](anonymous-first.md#authenticated-tool-error-boundary). Raw HTTP 402 remains `transport` without fallback.

Pi receives no raw response bodies, headers, exceptions, credential-bearing upstream URLs, or causes. Unknown exceptions are sanitized at the adapter boundary too. Abort reasons remain internal; Pi receives `Operation aborted` without a cause and renders `Cancelled`. Successful text preservation is tested separately from error secrecy. Storage failures expose no file contents, paths or causes. Ordinary web calls surface `storage` failures when settings or needed OAuth state cannot be read, or refresh cannot be committed or cleaned up. Provider failures take precedence over earlier HTTP 401 observations. OAuth revision conflicts remain private storage behavior. Explicit login uses private fixed messages for `login-in-progress`, `login-timeout`, `login-denied` and `login-cancelled`; command failures use notifications, never tool results or persisted messages. The authorization URL is restricted to transient login UI. See [management behavior](management.md).

The schemas and rendering implementation are in [`src/register-tools.ts`](../../../src/register-tools.ts); text extraction is in [`src/exa-mcp-client.ts`](../../../src/exa-mcp-client.ts). See [quality criteria](../quality.md) for verification responsibilities.
