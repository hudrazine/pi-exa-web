# v0.2.0 OAuth and Routing Implementation Plan

**Status:** PR1–PR5 merged with CI verified; PR6 documentation/package work verified locally and in review, PR CI pending; Hosted smoke and release verification pending **Target:** `@hudrazine/pi-exa-web@0.2.0`

This plan defines delivery order and completion for the OAuth feature accepted on 2026-09-09. The accepted [routing design](../proposals/oauth-routing.md) and [state design](../proposals/oauth-state.md) define its behavior; the [verification specification](oauth-verification.md) owns acceptance checks. Both strategies, the OAuth lifecycle and the [SQLite coordination contract](../decisions/sqlite-state-locking.md) are implemented. Documentation/package preparation, Hosted compatibility and release verification have separate completion conditions below.

## Scope and Dependencies

The [current architecture](../architecture.md) includes merged, unreleased PR1–PR5 foundations, routing, OAuth refresh, staged login and management commands, with no credential migration. Existing tool, renderer, rate-limit, concurrency, and lifecycle tests provide the regression baseline.

The [SQLite coordination decision](../decisions/sqlite-state-locking.md) is accepted, including the target Node.js minimum; [package.json](../../../package.json) defines the implemented runtime requirement.

Before release, confirm Hosted registration, consent, token issuance, and refresh through the [Hosted smoke](oauth-verification.md#hosted-oauth-release-smoke). Public source establishes the protocol approach, not account/deployment compatibility.

Prefer official contracts, pinned source, and explicit inference over separate feasibility experiments. Write local integration tests with the feature. Revisit a source-backed decision only after a relevant upstream change or concrete mismatch. Hosted verification is a release condition, not a prerequisite to starting OAuth implementation.

## Implementation Sequence

Track individual review units, acceptance criteria, and progress in the [local ticket and PR tracker](oauth-tickets.md). The stages below describe the delivery scope; ticket status and PR links are maintained in that tracker.

The following stages implement the accepted design. Each stage uses the [verification specification](oauth-verification.md).

### 1. Private Connections and Fixtures

- [x] Introduce lazy route-specific connections and move routing from HTTP-body replay to the intent-level executor. Keep raw HTTP observation in transport middleware.
- [x] Add package-owned safe errors, shared-connection cancellation, and shutdown handling.
- [x] Exact-pin the reviewed MCP client `2.0.0` and extend local HTTP fixtures for real-SDK MCP checks without adding dependencies.
- [x] Add local fake authorization services with the OAuth tickets. Any matching server fixture dependency must be exact-pinned and development-only.

### 2. Anonymous and API-key Routing

- [x] Implement both strategies for anonymous/API-key access, classifiers, one-second no-header probe and fixed cooldown, header-derived deadlines and retry budgets. PR4 adds OAuth resolution.
- [x] Retain initialization-time API-key reading and attach credentials only to their route connection.
- [x] Verify anonymous/API-key routing, probe/cooldown and connection regression contracts locally. PR3 four-job CI passed for `a0b32de`; PR #17 merged as `346f0f8`.

### 3. Persistent State and OAuth

- [x] Raise `engines.node` to `>=24.15.0` and implement OAuth exclusion using separate SQLite connections without a local mutex, and revisioned OAuth JSON transactions. Implement settings as validated last-write-wins JSON replacement without a revision or lock. PR2 merged after all four CI jobs passed.
- [x] Implement per-call settings snapshots and `/exa strategy` display/replacement.
- [x] Implement OAuth revision observation, non-interactive refresh including 401 recovery, and private local logout in PR4; four-job CI passed and PR #19 merged as `b21738f`.
- [x] Implement staged login in PR5; [final four-job CI passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34440460305) for `db30761`, and PR #20 merged as `cc84794`.

### 4. Pi Integration

- [x] Register `/exa` management commands with the local-TUI login boundary, cancellable callback UI, and browser-opening fallback.
- [x] Extend anonymous/API-key route/fallback details and rendering; preserve tool schemas and successful text. PR4 adds OAuth display.
- [x] Connect Pi shutdown/reload to active operations, refresh/logout, all route connections and lock-wait cleanup.
- [x] Add login/callback shutdown cleanup in PR5.

### 5. Release Preparation

- [x] Complete PR6's local check/test, real Pi loader, package dry run and Changesets status checks (T12); [local evidence](oauth-verification.md#pr6-verification).
- [ ] Pass all four CI jobs on PR6's final commit (T12); earlier PR results do not substitute for this run.
- [x] Document commands, state protection/recovery, local logout, retry changes, initialization-time API-key headers, and SQLite's runtime constraints including the raised Node.js minimum in README (T12).
- [x] Align product scope, architecture, tool/authentication contracts, quality guidance and SQLite implementation status with merged implementation evidence. Require an isolated agent directory for anonymous release smoke so saved OAuth cannot affect it (T12).
- [x] Review the existing minor Changeset targeting `0.2.0` without duplication (T12); the release PR owns version/changelog updates.
- [ ] Complete the [Hosted OAuth smoke](oauth-verification.md#hosted-oauth-release-smoke), including actual token issuance and restart/refresh (T13).
- [ ] Follow the [release procedure](../releases.md), including registry-artifact and anonymous post-publication smoke checks. Also complete the first managed publication's [automation verification](changesets-release-automation.md) (T14).

## Completion

T12 completes documentation and local/runtime/package verification after PR6 merges with required CI passing. It does not establish release readiness: T13 must also verify Hosted login and refresh. T14 then owns the separately authorized release and post-publication verification through [release PR #18](https://github.com/hudrazine/pi-exa-web/pull/18). Source review and local fixtures do not establish Hosted deployment compatibility.

Update current specifications and user guidance only with implemented, verified behavior. Record useful release evidence separately and update the SQLite decision's implementation status.
