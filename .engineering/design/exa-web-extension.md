---
type: design
status: active
---

# Exa Web Extension Design

## Purpose

`@hudrazine/pi-exa-web` is a Pi Package for npm distribution that adds basic web search and page retrieval to Pi. It exposes two Pi-native tools and uses Exa Hosted MCP as a private backend.

This document defines the implemented and accepted design for the initial `0.1.0` release.

## Public Contract

The package declares one TypeScript Pi Extension source through `pi.extensions` and defines no npm library exports. MCP clients, transports, authentication policy, and vendor response types are not public APIs.

The extension registers these tools:

```text
web_search
├─ query: string
└─ numResults?: integer (1..20)

web_fetch
├─ url: string
└─ maxCharacters?: integer (1..20,000)
```

These bounds are the accepted `0.1.0` public contract.

- Omitted optional values are omitted from the MCP call so Exa owns its defaults.
- `web_fetch.url` is converted internally to the `urls` array required by `web_fetch_exa`.
- Tool `content` preserves Exa's text response without parsing it into a package-owned search-result format.
- A remote MCP result with `isError: true` is thrown as a Pi tool error rather than returned as successful content.
- The package does not export its internal types or support importing internal modules through package subpaths.

Successful results carry stable UI metadata in `details`:

```ts
{
  provider: "exa";
  operation: "search" | "fetch";
  auth: "anonymous" | "api-key";
  query?: string;
  url?: string;
  requestedNumResults?: number;
  maxCharacters?: number;
}
```

The UI displays the query or URL, requested limits, and actual authentication route. It does not display or retain the API key, HTTP headers, or raw MCP protocol data. A requested result count must not be presented as an actual returned count.

## Internal Boundaries

The implementation uses a small number of private modules. Filenames may change, but their responsibilities must remain separated.

### Pi extension adapter

Owns Pi-specific concerns:

- tool schemas, descriptions, and registration
- conversion from Pi arguments to intent-level client calls
- success metadata supplied to renderers
- registration of the `session_shutdown` cleanup hook

It must not implement HTTP retries, inspect MCP JSON-RPC bodies, or decide when an API key is used.

### Exa MCP client

Exposes only intent-level private operations equivalent to `search`, `fetch`, and `close`. It owns:

- lazy creation of one MCP `Client` and Streamable HTTP transport
- concurrent connection deduplication
- mapping to `web_search_exa` and `web_fetch_exa`
- forwarding cancellation to `Client.callTool`
- conversion of MCP content and MCP tool errors into the extension's internal result
- connection cleanup and recovery after initialization failure

Callers do not know MCP tool names, session handling, or authentication mechanics.

### Anonymous-first policy

Owns the custom `fetch` middleware, the anonymous availability state, rate-limit parsing, retry delay, and API-key fallback. It only treats an HTTP 429 for a JSON-RPC `tools/call` request as an anonymous free-tier limit.

Authentication-route metadata must remain correct for concurrent calls. A private `AsyncLocalStorage` call context around `Client.callTool` provides that isolation. Local integration tests through the real SDK prove that concurrent anonymous and API-key calls retain their own routes. A global `lastAuthMode` is not allowed.

### Renderer

Owns Pi TUI presentation based only on tool arguments, safe error text, and stable `details`. It must not parse Exa response text or read authentication state directly.

The standard Pi tool shell owns pending, success, and error framing. Collapsed calls show the query or URL and any requested limit; collapsed results show completion and the successful authentication route. Expanded results show the Exa text unchanged except for terminal-sequence removal and line-ending normalization. Errors use a concise collapsed summary and safe expanded text, while cancellation is normalized to `Cancelled`.

No generic provider interface, generic MCP adapter, dependency-injection container, or configuration subsystem is introduced in v1. Private construction seams may be used where they directly enable deterministic tests.

## Anonymous-first State Model

The policy stores only `anonymousBlockedUntil` in process memory. The presence of `EXA_API_KEY` is configuration, not another state.

```text
AVAILABLE
  ├─ non-429 success/error ────────────────> AVAILABLE
  └─ free-tier HTTP 429
       ├─ retry delay <= 2 seconds
       │    ├─ anonymous retry succeeds ───> AVAILABLE
       │    └─ anonymous retry is 429 ─────> BLOCKED
       └─ delay > 2 seconds or unknown ────> BLOCKED

BLOCKED(until)
  ├─ now < until, API key exists ─────────> authenticated call
  ├─ now < until, no API key ─────────────> rate-limit error
  └─ now >= until ────────────────────────> AVAILABLE and anonymous call
```

For a transition to `BLOCKED`:

1. Parse `Retry-After`, accepting delta seconds and HTTP dates.
2. Use `X-RateLimit-Reset` as a fallback when valid, accepting Exa's epoch milliseconds and conventional epoch seconds.
3. If neither header is usable, block for one second to prevent a hot retry loop without hiding anonymous availability for long.

When an API key exists, the policy retries the same JSON-RPC call once with `x-api-key`. It never sends the key in the URL and does not attach the key to initialization, listing, ping, or other non-tool requests.

The authenticated result is final. An authenticated 429, MCP tool error, network failure, or server failure does not fall back to anonymous and does not enter a retry cycle. Automatic replay is limited to Exa's anonymous HTTP 429 because the current Exa handler returns that response before executing the tool.

Parallel callers may observe the same initial 429 and independently fall back. v1 does not add a client-side QPS scheduler because hosted limits are server-owned and may change.

## Errors And Cancellation

- Invalid Pi tool arguments are rejected by TypeBox before execution.
- Missing API key after an anonymous limit produces a concise error that names `EXA_API_KEY` and gives the Exa dashboard URL.
- MCP `isError` results, SDK failures, and network failures are thrown so Pi marks the tool call as failed.
- Error messages must not include the API key, request headers, or full request objects.
- The Pi `AbortSignal` is passed to each `callTool` request.
- The optional anonymous retry delay observes the same signal and stops immediately when aborted.
- A caller canceled while awaiting the shared initial connection stops awaiting it, but does not cancel a connection another concurrent call may need.
- A transport failure after a request may have reached Exa is not automatically replayed.

## Lifecycle

- Extension loading performs no network I/O.
- The first tool call starts one shared connection attempt.
- Concurrent first calls await the same connection promise.
- A failed initialization closes partial resources and clears cached state so a later call may reconnect.
- `session_shutdown` waits at most one second for best-effort MCP session termination, then closes the client and transport even when termination fails or does not respond.
- Closing the client rejects in-flight SDK requests. New work is not started after shutdown begins.
- `anonymousBlockedUntil` is not persisted and resets with the extension runtime.

## Dependencies And Packaging

The package-owned runtime dependency is limited to `@modelcontextprotocol/client` for the MCP v2 client and Streamable HTTP transport.

Packages supplied by Pi are declared as peer dependencies with the range `*`, following Pi's package contract:

- `@earendil-works/pi-coding-agent` for extension APIs and types
- `@earendil-works/pi-tui` for custom rendering
- `typebox` for Pi tool schemas

The same Pi packages have concrete development versions for local type checks and compatibility tests. A local MCP server package may be a development-only test dependency; it must not enter runtime dependencies.

The package manifest must:

- declare `engines.node` as `>=22.19.0`, matching the current Pi requirement
- include the `pi-package` keyword and a `pi.extensions` entry targeting the TypeScript source
- publish only the required source files and no generated distribution artifact
- define no npm library export surface; Pi's manifest is the package entry contract

The API key is read only from `EXA_API_KEY`. v1 has no settings file, command, prompt, or alternate endpoint configuration.

## Test Strategy

Deterministic tests use fake time and local transports; CI must not depend on Exa availability or consume Exa quota.

- Tool contract tests verify names, schemas, bounds, argument mapping, details, and thrown MCP errors.
- Anonymous-first unit tests cover short and long 429s, missing headers, API-key absence, authenticated failure, block expiry, cancellation during delay, and no retry cycles.
- Parallel tests prove call-local authentication metadata and single connection initialization.
- Lifecycle tests cover initialization failure, later reconnection, in-flight closure, non-responsive session termination, and repeated shutdown.
- Renderer tests cover pending, success, error, collapsed, and expanded output without snapshots of unstable styling.
- A local MCP integration test uses the real v2 client and transport to verify body replay, headers, cancellation, and session closure.
- Manual release smoke testing installs the package through Pi and makes one bounded anonymous call with each tool; it does not intentionally exhaust anonymous quota to force live fallback.
- Package verification runs `vp run check` and `vp run test`, previews the npm publish file list without creating a tarball, and loads its TypeScript entry through Pi's real extension loader.

Runtime `listTools()` validation is intentionally omitted from v1. Missing or renamed remote tools surface as MCP tool errors, while the manual release smoke test detects drift without adding latency to every user's first call.

## Non-goals

- a reusable Exa client library or public internal API
- a generic MCP client Extension
- providers other than Exa
- Exa advanced search, Agent, OAuth, or direct Exa API integration
- multiple-URL `web_fetch` input
- custom endpoints, proxy settings, persistent quota state, or configurable retry policy
- parsing Exa text into a package-owned result schema
- caching, telemetry, client-side rate scheduling, or cross-process coordination

## Verification Status

The private policy has deterministic evidence for its state transitions, abort-aware delay, header parsing, and API-key isolation. Local integration tests using the real MCP client and Streamable HTTP transport verify call-local authentication metadata under parallel calls, exact string-body replay during fallback, request cancellation, initialization recovery, and bounded session shutdown when termination does not respond. Renderer tests using Pi's real `ToolExecutionComponent` verify pending, collapsed, expanded, and error states with the current Pi version. Pi's real extension loader has also loaded the TypeScript source entry and registered both tools without a build step.

A manual local-path installation with no `EXA_API_KEY` configured verified that an actual Pi agent can execute both `web_search` and `web_fetch` against Hosted Exa through the `anonymous` route. The published `@hudrazine/pi-exa-web@0.1.0` registry package then passed the same bounded anonymous calls after installation through Pi. Its seven-file npm artifact matched the release source, and npm Trusted Publisher attached provenance to the approval-gated OIDC publication. The completed release evidence is retained in the [Initial Release Plan](../plans/archive/initial-release.md).

The Exa GitHub main branch and Hosted MCP documentation currently differ in some default values and optional search inputs. The package therefore relies only on the stable common subset and never duplicates Exa defaults.
