# Product and Scope

`@hudrazine/pi-exa-web` gives Pi users basic web search and single-page retrieval through the Pi-native tools `web_search` and `web_fetch`. Exa Hosted MCP is the private backend; users do not configure or manage an MCP server. Anonymous access supports initial use without credentials. An optional API key provides access after an anonymous rate limit.

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

The web tools retain the `0.1.0` feature scope: Exa only, one URL per fetch, anonymous-first access, and an optional `EXA_API_KEY`. Merged, unreleased PR1 adds safe errors and separate route connections, including session recovery and HTTP cancellation. Local PR2 adds private settings/OAuth JSON storage and SQLite coordination, which the tools do not yet use. There are no management commands or persistent quota state. Installation and end-user usage belong in the [README](../../README.md).

Advanced Exa search, Agent features, direct Exa API integration, alternate providers, custom endpoints/proxies, caching, telemetry, client-side rate scheduling, and configurable retry policies are outside this scope.

## Development Direction

OAuth login and selectable access strategies are accepted for `0.2.0`, together with the OAuth state lifecycle, SQLite coordination and higher Node.js minimum. PR1 supplies the connection foundation; PR2 supplies private storage and the new runtime floor. OAuth operations and selectable routing remain unimplemented. The [OAuth plan](plans/oauth-routing.md) defines delivery and links to the contracts.

Changesets release automation is implemented. Its first complete managed publication remains an independent [verification task](plans/changesets-release-automation.md).
