# Product and Scope

`@hudrazine/pi-exa-web` adds basic web search and single-page retrieval to Pi through two Pi-native tools, `web_search` and `web_fetch`. Exa Hosted MCP is the private backend; users do not manage an MCP server. Anonymous access makes initial use possible without credentials, and API-key fallback provides access after an anonymous rate limit.

The implemented package version is `0.1.0`. Installation and end-user instructions belong in the [README](../../README.md). The [tool contract](design/web-tools.md) and [anonymous-first policy](design/anonymous-first.md) define its behavior.

## Requirements and Boundaries

- Distribute one npm Pi Package with a TypeScript extension entry. Pi loads the source through jiti; there is no build step or generated distribution artifact.
- Expose Pi tools, not a reusable Exa library. MCP clients, transports, vendor types, and internal module imports are not supported public APIs.
- Return Exa text without converting it into a package-owned search-result schema. Leave omitted limits to Exa so the package does not duplicate vendor defaults.
- Report the actual authentication route separately from successful tool text, including under concurrent calls.
- Propagate cancellation, clean up connections on shutdown, and avoid replay when a request may already have executed.
- Keep credentials out of URLs, UI metadata, and error output. The [error-handling limitation](design/web-tools.md#errors-and-secret-handling) distinguishes this requirement from the current implementation.
- Keep normal verification deterministic and independent of Hosted Exa availability and quota.

## Current Scope

The package supports Exa only, one URL per fetch, and an API key read from `EXA_API_KEY`. It has no management commands, settings file, OAuth, persistent quota state, or cross-process coordination.

Advanced Exa search, Agent features, direct Exa API integration, alternate providers, custom endpoints/proxies, caching, telemetry, client-side rate scheduling, and configurable retry policies are outside the current scope. A generic provider interface, generic MCP adapter, dependency-injection container, or configuration subsystem is not needed for these requirements. Private construction seams are appropriate where deterministic tests require them.

## Planned Work

The [OAuth and routing proposal](plans/oauth-routing-design.md) targets `0.2.0` with explicit login and selectable access strategies. It remains proposed and unimplemented. Its [SQLite coordination decision](decisions/sqlite-state-locking.md), including a higher Node.js minimum, is accepted for that target; acceptance does not describe the installed package.

The release workflow is implemented, but the [first Changesets-managed publication](plans/changesets-release-automation.md) still needs end-to-end verification. That work is independent of OAuth implementation.
