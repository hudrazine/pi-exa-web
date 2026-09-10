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

## Scope and Constraints

The package supports anonymous access, saved OAuth and an optional startup API key. Users can select anonymous-first or authenticated-first routing and manage OAuth through Pi commands. Anonymous-first favors account-credit conservation and may wait briefly; it does not promise the shortest latency.

OAuth login requires local interactive Pi. Saved credentials and non-interactive refresh work in other Pi modes. State belongs to the Pi agent directory on a supported local filesystem, independently of the working project. There is no credential migration from other packages.

Keep one package, one source-loaded extension and Exa as the backend. Advanced Exa search, Agent features, direct Exa API integration, alternate providers, custom endpoints/proxies, multiple accounts, keychains, remote callback relays or automatic SSH forwarding, network-filesystem persistence, result caching, telemetry, quota scheduling and configurable retry policies are outside the scope. Do not introduce a public SDK, stdio MCP server or build step.

## Quality and Delivery

The package must load through Pi's real extension loader, preserve the tool and authentication contracts under concurrency and cancellation, and keep normal verification independent of Hosted availability. [Quality criteria](quality.md) define required evidence; the [release procedure](releases.md) separates local verification, Hosted compatibility and authorized publication. [Project status](README.md#project-status) identifies the completed release and planning state.
