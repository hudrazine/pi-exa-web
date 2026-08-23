---
type: plan
status: archived
---

# Initial Implementation Plan

## Goal

Implement and locally verify a Pi Package that follows the accepted [Exa Web Extension design](../../design/exa-web-extension.md) without adding generic provider or MCP abstractions.

## Completed State

- The package manifest identifies the real npm package, TypeScript source extension entry, supported Node.js runtime, and Pi peer dependencies without defining an npm library export or generated artifact.
- The default extension registers only `web_search` and `web_fetch` through a private intent-level client seam.
- Contract tests cover names, schemas, bounds, argument mapping, success content, and stable details.
- A private policy recognizes only replay-safe JSON `tools/call` requests, tracks anonymous blocking in memory, and performs the accepted short retry and API-key fallback behavior.
- Deterministic tests cover rate-limit headers, block expiry, cancellation, terminal authenticated failures, secret isolation, and parallel authentication-route tracking.
- The default extension lazily shares one real MCP client and transport, maps both Exa tools, forwards cancellation, and bounds best-effort session termination to one second during `session_shutdown`.
- Local integration tests cover SDK negotiation, exact fallback body replay, concurrent authentication routes, initialization recovery, request cancellation, and bounded shutdown when session termination does not respond, without contacting Hosted Exa.
- Pi-native renderers show compact calls, progress, successful authentication routes, safe errors, cancellation, and unparsed Exa text on expansion.
- Renderer contract tests and Pi's real `ToolExecutionComponent` cover pending, collapsed, expanded, and error states.
- A local-path installation with no API key configured verified that an actual Pi agent can execute both tools against Hosted Exa through the `anonymous` route.
- The public README documents installation, tool inputs, anonymous-first authentication, limits, troubleshooting, and local development without exposing internal implementation details.

## Phase 1: Establish The Package Contract

- [x] Replace starter package metadata with the real name, description, repository fields, `pi-package` keyword, TypeScript `pi.extensions` source entry, published files, and Node.js engine.
- [x] Add only the accepted runtime, peer, and development dependencies.
- [x] Replace the placeholder test with contract tests for `web_search` and `web_fetch` registration, schemas, bounds, and argument mapping.
- [x] Add the minimal default Extension entry that registers the two tools; keep network work behind a private construction seam.
- [x] Verify direct TypeScript source loading with Pi's real extension loader locally.

## Phase 2: Implement Anonymous-first Policy

- [x] Write deterministic failing tests for every transition in the accepted state model.
- [x] Implement `tools/call` detection without applying fallback to other MCP requests.
- [x] Implement abort-aware short delay, rate-limit deadline parsing, in-memory blocking, and `x-api-key` fallback.
- [x] Prove that authenticated failures cannot loop back to anonymous.
- [x] Prove that API keys cannot appear in errors, URLs, or policy results.

## Phase 3: Add MCP Connection And Lifecycle

- [x] Add the lazy shared MCP client and Streamable HTTP transport.
- [x] Map the two intent-level operations to the two Exa MCP tools.
- [x] Forward Pi cancellation and throw MCP `isError` results.
- [x] Clear partial state after failed initialization without replaying ambiguous tool calls.
- [x] Implement idempotent `session_shutdown` cleanup with at most one second of best-effort session termination.
- [x] Validate the real SDK against a local MCP server, including body replay and parallel calls.
- [x] Confirm the `AsyncLocalStorage` authentication-route mechanism with real SDK test evidence.

## Phase 4: Complete Pi Integration And Rendering

- [x] Return client text unchanged as model content and safe, stable `details` for UI use.
- [x] Implement concise call and result renderers for query, URL, requested limits, progress, errors, and authentication route.
- [x] Ensure requested counts are not labeled as actual returned counts.
- [x] Add user-facing errors for anonymous rate limits and missing `EXA_API_KEY`.
- [x] Test cancellation, concurrent first calls, non-responsive session termination, and repeated shutdown.
- [x] Test renderer states.

## Implementation Closure

- [x] Install the local source package through Pi with no API key configured and exercise both tools through the `anonymous` route against Hosted Exa.
- [x] Replace the starter README with concise installation, API-key, behavior, limits, and troubleshooting guidance.

## Completion Criteria

- The local package registers only `web_search` and `web_fetch` and both tools work anonymously against Exa Hosted MCP.
- Deterministic integration tests prove that an anonymous 429 follows the documented retry and authenticated fallback policy without consuming live quota.
- Cancellation and shutdown do not leave active requests or reusable stale connections.
- Parallel calls report their own authentication routes correctly.
- Normal CI is deterministic and does not contact Exa.
- Package checks, tests, real-loader verification, and local-path installation pass without a build step.
- Implemented behavior and user documentation agree with the active design.

## Release Handoff

The implementation closed after local package verification. Versioning, final package inspection, npm publication, and registry installation were completed under the archived [Initial Release Plan](initial-release.md).
