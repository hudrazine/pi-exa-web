# Product and Scope

`@hudrazine/pi-exa-web` gives Pi users basic web search and single-page retrieval through the Pi-native tools `web_search` and `web_fetch`. Exa Hosted MCP is the private backend; users do not configure or manage an MCP server. Anonymous access supports initial use without credentials. Saved OAuth or an optional API key provides access after an anonymous rate limit or as the primary route under authenticated-first.

## Product Requirements

- Deliver one npm Pi Package with a TypeScript extension entry, loaded by Pi through jiti.
- Expose Pi tools rather than a reusable Exa library. MCP clients, transports, vendor types, and internal imports are not supported public APIs.
- Preserve Exa's successful text without introducing a package-owned result schema. Let Exa supply omitted limits.
- Report the actual successful authentication route separately from tool text, including under concurrent calls.
- Propagate cancellation, clean up connections on shutdown, and avoid replay when a request may already have executed.
- Keep credentials out of URLs, UI metadata, and error output.
- Keep normal verification deterministic and independent of Hosted Exa availability and quota.

The [tool contract](design/web-tools.md) owns caller-visible behavior and the safe-error boundary. The [authentication contract](design/anonymous-first.md) owns credential use and replay. The [architecture](architecture.md) explains how these requirements are implemented; [quality criteria](quality.md) define the required evidence.

## Implemented Scope

The web tools remain Exa-only with one URL per fetch. Merged, unreleased changes add separate anonymous/OAuth/API-key connections, saved routing strategies, bounded anonymous probes/cooldown, one credit-error fallback, and safe failure messages. OAuth supports local-TUI login with validation before revision-protected storage, non-interactive refresh, one same-route 401 recovery, local status and logout. JSON replacement and SQLite exclusion coordinate OAuth state; quota state stays process-local. Installation and end-user usage belong in the [README](../../README.md).

Advanced Exa search, Agent features, direct Exa API integration, alternate providers, custom endpoints/proxies, caching, telemetry, client-side rate scheduling, and configurable retry policies are outside this scope.

## Development Direction

OAuth login and selectable access strategies target `0.2.0`, together with SQLite coordination and the higher Node.js minimum. PR1–PR5 are merged with CI verified. PR6 prepares documentation and package evidence; Hosted OAuth smoke and release verification remain pending. The [OAuth plan](plans/oauth-routing.md) defines delivery and links to the contracts.

Changesets release automation is implemented. Its first complete managed publication remains an independent [verification task](plans/changesets-release-automation.md).
