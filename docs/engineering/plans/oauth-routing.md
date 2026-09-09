# v0.2.0 OAuth and Routing Implementation Plan

**Status:** Active planning; implementation not started  
**Target:** `@hudrazine/pi-exa-web@0.2.0`

This plan defines delivery order and completion for the proposed OAuth feature. The [routing proposal](../proposals/oauth-routing.md) and [state proposal](../proposals/oauth-state.md) define its behavior; the [verification specification](oauth-verification.md) owns acceptance checks. The full feature remains proposed. Only the [SQLite coordination decision](../decisions/sqlite-state-locking.md) and its lock contract are accepted.

## Scope and Dependencies

The [implemented `0.1.0` architecture](../architecture.md) uses one MCP connection with anonymous-first HTTP replay and `EXA_API_KEY` only. There are no saved OAuth credentials or settings to migrate. Existing tool, renderer, rate-limit, concurrency, and lifecycle tests provide the regression baseline.

The [SQLite coordination decision](../decisions/sqlite-state-locking.md) is accepted, including the target Node.js minimum; [package.json](../../../package.json) defines the implemented runtime requirement.

Before release, confirm Hosted registration, consent, token issuance, and refresh through the [Hosted smoke](oauth-verification.md#hosted-oauth-release-smoke). Public source establishes the protocol approach, not account/deployment compatibility.

Prefer official contracts, pinned source, and explicit inference over separate feasibility experiments. Write local integration tests with the feature. Revisit a source-backed decision only after a relevant upstream change or concrete mismatch. Hosted verification is a release condition, not a prerequisite to starting OAuth implementation.

## Implementation Sequence

The following stages describe implementation of the proposal; their order does not change its acceptance status. Each stage uses the [verification specification](oauth-verification.md).

### 1. Private Connections and Fixtures

- [ ] Introduce lazy route-specific connections and move routing from HTTP-body replay to the intent-level executor. Keep raw HTTP observation in transport middleware.
- [ ] Add package-owned safe errors, shared-connection cancellation, and shutdown handling.
- [ ] Exact-pin the reviewed MCP client `2.0.0` (currently `^2.0.0`). Add local fake MCP/authorization services and only the private test seams needed to exercise the real SDK. Any matching server fixture dependency must be exact-pinned and development-only.

### 2. Anonymous and API-key Routing

- [ ] Implement both strategies, authenticated-route resolution, classifiers, probe/cooldown policy, and retry budgets from the design.
- [ ] Retain initialization-time API-key reading and attach credentials only to their route connection.
- [ ] Verify proposed no-header probing, cooldown bypass without usable credentials, and route-specific connections against their proposal contracts; retain other current regression requirements.

### 3. Persistent State and OAuth

- [ ] Raise `engines.node` to `>=24.15.0` and implement the private SQLite lock wrapper and revisioned JSON transactions under the accepted contract.
- [ ] Implement per-call settings reads, OAuth revision observation, staged login, non-interactive refresh including 401 recovery, and local logout.

### 4. Pi Integration

- [ ] Register `/exa` management commands with the local-TUI login boundary, cancellable callback UI, and browser-opening fallback.
- [ ] Extend safe route/fallback details and rendering; preserve tool schemas and successful text.
- [ ] Connect Pi shutdown/reload to login, active operations, connections, and lock-wait cleanup.

### 5. Release Preparation

- [ ] Pass the [local verification and Hosted OAuth smoke](oauth-verification.md).
- [ ] Document commands, state protection/recovery, local logout, retry changes, initialization-time API-key headers, and SQLite's runtime constraints including the raised Node.js minimum in README.
- [ ] Update product scope, architecture, tool/authentication contracts, and quality guidance after implementation verification. Require an isolated agent directory for anonymous release smoke tests so saved OAuth credentials cannot affect them.
- [ ] Add a minor Changeset targeting `0.2.0`; let the release PR own version/changelog updates.
- [ ] Follow the [release procedure](../releases.md). If this is the first Changesets-managed publication, also complete the independent [automation plan](changesets-release-automation.md).

## Completion

Release readiness requires the SQLite lock contract, both strategies, and OAuth working through the existing Pi tools, with all [local, runtime, package, and Hosted checks](oauth-verification.md) complete. Source review alone does not establish implementation or deployment compatibility.

Update current specifications and user guidance only with implemented, verified behavior. Record useful release evidence separately and update the SQLite decision's implementation status.
