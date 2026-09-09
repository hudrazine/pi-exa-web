# v0.2.0 Local Tickets and PR Tracking

**Status:** PR1–PR3 merged; PR4 implemented and verified locally on development/minimum Node, OS CI pending; PR5/PR6 not started

This tracker organizes the accepted 0.2.0 design into local tickets and PRs. Use T1–T14 as stable ticket IDs without GitHub Issues. The authoritative designs are [routing](../proposals/oauth-routing.md), [OAuth state](../proposals/oauth-state.md), and [SQLite locking](../design/oauth-state-locking.md). This document tracks scope, acceptance criteria, dependencies, and progress. The review baseline is `c6158b20fbc32d09bc7853836a4142e33a841ecc`.

## Workflow

- Group related implementation tickets into the six PRs below. PR1–PR6 are local planning IDs, not GitHub PR numbers. Preserve ticket IDs and individual acceptance criteria.
- Before starting, confirm that prerequisite work in other PRs is complete. Implement and verify dependent tickets within the same PR in the listed order; they do not require separate merges. Use only the existing checkout and do not create another worktree.
- Track progress as `Todo → In progress → In review → Done`. When an execution condition prevents progress, record `Waiting` and the reason. Readiness describes definition quality, separately from progress or permission to publish.
- Link PR descriptions to the relevant ticket headings in this file and describe the implemented scope and verification results. Record the actual PR URL in the table when creating the PR.
- Update the relevant ticket status in each PR. Mark an implementation ticket Done only when its acceptance criteria and required checks are satisfied and its PR is merged. Reflect the merge in the next documentation update.
- T13/T14 track execution and evidence. Mark them Done with links to evidence satisfying their acceptance criteria. Evidence updates may use a separate or related PR; execution itself need not become a code PR. Also record the Changesets-generated release PR for T14.
- See the [implementation plan](oauth-routing.md) for overall stages and completion, and the [verification specification](oauth-verification.md) for detailed verification obligations. Add tests in the PR that implements the relevant feature.

## PR groups

| PR unit | Tickets (implementation order) | Review scope | Prerequisite PRs |
| --- | --- | --- | --- |
| PR1 | T1 → T2 | Safe failure classification and route-specific MCP connections. Review connection, replay, and shutdown boundaries together. | None |
| PR2 | T4 → T5 → T11 | SQLite OAuth locking, revisioned credentials, and last-write-wins settings. Verify the storage contract, including CI for supported operating systems and the minimum Node version. | PR1 |
| PR3 | T3 → T6 | Anonymous probes/cooldown, strategy settings, 402 fallback, and display. Review anonymous/API-key routing end to end. | PR1, PR2 |
| PR4 | T8 → T9 | Non-interactive refresh, local logout, OAuth route selection, and 401 recovery. Use saved-state fixtures to verify authentication during ordinary tool calls. | PR3 |
| PR5 | T7 → T10 | Staged login and Pi management UI. Verify explicit login, persistence, use, logout, and shutdown. | PR4 |
| PR6 | T12 | Document implemented behavior, verify package contents, and prepare the release through Changesets. | PR5 |

T3 in PR3 depends only on PR1, but its companion T6 also needs persistence from PR2. PR4/PR5 depend transitively on PR1/PR2. Individual ticket definitions below are authoritative for ticket dependencies; this table describes prerequisites for each complete PR.

Split OAuth into ordinary-call authentication (PR4) and interactive login and management (PR5). This keeps refresh with 401 recovery, and login with its UI, in the same review. T13 can run after PR5 without waiting for PR6 documentation work. Run T14 after PR6 and T13 complete. The Changesets-generated release PR is separate from these six work PRs.

## Progress

| Ticket | PR unit | Scope | Progress | PR / evidence |
| --- | --- | --- | --- | --- |
| T1 | PR1 | Safe errors and SDK pinning | Done | [Merged PR #15](https://github.com/hudrazine/pi-exa-web/pull/15) |
| T2 | PR1 | Route-specific MCP connections | Done | [Merged PR #15](https://github.com/hudrazine/pi-exa-web/pull/15) |
| T3 | PR3 | Anonymous probes and cooldown | Done | [Merged PR #17](https://github.com/hudrazine/pi-exa-web/pull/17), `346f0f8`; [four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34330004672) for `a0b32de` |
| T4 | PR2 | SQLite locking | Done | [Merged PR #16](https://github.com/hudrazine/pi-exa-web/pull/16); [four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34322919016) |
| T5 | PR2 | OAuth revisions and settings replacement | Done | [Merged PR #16](https://github.com/hudrazine/pi-exa-web/pull/16); [four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34322919016) |
| T6 | PR3 | Strategy settings, 402 fallback, and display | Done | [Merged PR #17](https://github.com/hudrazine/pi-exa-web/pull/17), `346f0f8`; [four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34330004672) for `a0b32de` |
| T7 | PR5 | OAuth login validation and commit | Todo | — |
| T8 | PR4 | Refresh and local logout | In review | [Draft PR #19](https://github.com/hudrazine/pi-exa-web/pull/19); local dev/minimum checks passed: rotating-token, L4/L5 and cleanup tests; OS CI/merge pending |
| T9 | PR4 | OAuth route selection and 401 recovery | In review | [Draft PR #19](https://github.com/hudrazine/pi-exa-web/pull/19); local dev/minimum checks passed: real SDK, retry/lifecycle and Pi boundary tests; OS CI/merge pending |
| T10 | PR5 | Pi management commands and shutdown | Todo | — |
| T11 | PR2 | CI for operating systems and minimum Node version | Done | [Merged PR #16](https://github.com/hudrazine/pi-exa-web/pull/16); [four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34322919016) |
| T12 | PR6 | Documentation, package contents, and Changeset | Todo | — |
| T13 | Verification gate | Hosted OAuth smoke | Todo | — |
| T14 | Verification gate | Release and first managed publication verification | Todo | — |

PR1 local verification is covered by `tests/anonymous-first.test.ts`, `tests/exa-mcp-client.test.ts`, and `tests/index.test.ts`: safe failures and retry times, route-specific sessions, cancellation, bounded recovery/shutdown, Pi source loading, rendering, and persisted error records. T1/T2 are merged. T3/T6 are also Done after PR #17 merged. PR4 adds `tests/oauth-state.test.ts`, `tests/oauth-routing.test.ts`, `tests/oauth-process.test.ts` and `tests/oauth-boundary.test.ts`; see the [verification record](oauth-verification.md#pr4-verification) for evidence. T8/T9 remain incomplete until PR4's four-job CI and merge; interactive management and Hosted verification remain pending.

## Shared acceptance requirements

- Each implementation ticket must satisfy its part of the [verification specification](oauth-verification.md) and pass `vp run check` and `vp run test`. Normal tests must not use Hosted Exa or a real browser.
- Preserve existing tool names, input bounds, single-URL input, optional-argument omission, and successful text. Do not add a public SDK, generic providers, or a build step.
- Include a Changeset for user-visible changes under the [Changeset policy](../../../.changeset/README.md). Leave version and CHANGELOG updates to the Changesets release PR.
- The acceptance criteria below summarize each ticket's implementation scope. If a specification change is needed, keep the authoritative design and relevant tickets aligned; do not change the design through a ticket alone.

## T1 — fix: replace raw upstream errors with safe package errors

Readiness: Ready  
Dependencies: None

Outcome: Stop propagating raw MCP/SDK exceptions so subsequent routing work can use safe failure classifications.

Acceptance criteria:

- Exact-pin the MCP client to the reviewed `2.0.0` and update the lockfile accordingly. Use existing local HTTP fixtures to verify failures through the real SDK. Add only necessary fixture dependencies; any added MCP server must be exact-pinned to the matching version and development-only.
- Construct errors from the design's failure codes and allowlisted metadata. Preserve the final failure code and `retryAt` only when supported by evidence. Do not pass raw bodies, headers, exceptions, or causes to Pi.
- Handle HTTP, network, MCP isError, and non-text responses safely. This ticket does not introduce new fallback behavior based on 402.
- Inject sentinels into headers, nested errors, causes, formatter suffixes, and credential-bearing URLs. Verify that they do not leak into Pi errors, details, logs, or persisted conversations. Preserve abort reasons internally while retaining Pi's existing Cancelled presentation.
- Verify successful text preservation separately from failure secrecy. Apply the same boundary to subsequent OAuth/storage errors without adding extra mechanisms for unimplemented paths.

References: [proposals/oauth-routing.md#failure-classification-and-safe-output](../proposals/oauth-routing.md#failure-classification-and-safe-output), [design/web-tools.md#errors-and-secret-handling](../design/web-tools.md#errors-and-secret-handling).

## T2 — refactor: execute anonymous and API-key calls on separate MCP connections

Readiness: Ready  
Dependencies: T1

Outcome: Move anonymous/API-key route switching from HTTP-body replay to an intent-level executor, with a separate connection for each route.

Acceptance criteria:

- Select routes outside `Client.callTool`. Limit middleware to observing HTTP status/headers and applying authentication for its route. Existing anonymous-to-API-key access works for both tools.
- Create connections lazily per route and deduplicate concurrent connection attempts. Initial loading makes no network requests. Close resources after failed initialization and allow later reconnection.
- Read and trim the API key at startup, and attach it only to requests that need it on the API-key connection, including initialization. Do not expose it on anonymous connections or in URLs.
- Cancelling one shared-connection waiter leaves the connection usable by other waiters. Tool HTTP observes the caller's signal. Concurrent calls on both routes report their actual successful route.
- Recover from expired-session 404 once on a fresh connection only when the rejected request carried a server-issued session ID. Do not replay non-session 404, network/5xx/401/403, or other ambiguous failures.
- Make close idempotent, reject new operations, and abort active operations and initialization. Close all connections in parallel with a one-second total session-termination grace. Verify both tools through the real SDK and local server.

References: [proposals/oauth-routing.md#private-responsibilities](../proposals/oauth-routing.md#private-responsibilities), [proposals/oauth-routing.md#connection-and-cancellation](../proposals/oauth-routing.md#connection-and-cancellation).

## T3 — feat: implement bounded anonymous probes and fixed cooldown

Readiness: Ready  
Dependencies: T2

Outcome: Update anonymous-first 429 handling to the 0.2.0 probe/cooldown contract.

Acceptance criteria:

- Apply this policy only to HTTP 429 on anonymous tools/call requests. Prefer Retry-After and handle seconds/HTTP dates, reset values in epoch seconds/milliseconds, past values, and invalid values according to the specification.
- Probe once when the initial delay is at most two seconds; skip both the wait and probe for longer delays. Without usable headers, wait one second and probe once. A second 429 determines the final deadline. Do not expose the default delay as an upstream-derived retryAt.
- Suppress anonymous primary selection only after a rate-limit fallback. Use a fixed one-second cooldown measured from the final no-header 429 observation, including on repeated failures. Retain header-derived deadlines. Concurrent failures update the deadline to the later of the active and new deadlines; do not maintain a failure count, exponent, or generation. Reset on anonymous success.
- When no authenticated route is usable, try anonymous even during cooldown and stop under the same probe limit. Keep cooldown process-local and clear it on close.
- Caller cancellation and shutdown interrupt waits without fallback. Session reconnection must not reset the one-anonymous-probe limit per logical call.
- Use fake time and synchronization barriers to verify the relevant anonymous 429, cooldown, concurrent-deadline, and retry-budget cases.

References: [proposals/oauth-routing.md#anonymous-probe-and-cooldown](../proposals/oauth-routing.md#anonymous-probe-and-cooldown).

## T4 — feat: coordinate OAuth transactions with node:sqlite

Readiness: Ready  
Dependencies: T1

Outcome: Implement OAuth exclusion under the accepted SQLite contract, with recovery after process exit.

Acceptance criteria:

- Raise `engines.node` to `>=24.15.0`. Load `node:sqlite` lazily for transactions and return a safe storage error if unavailable.
- Use only `oauth.lock.sqlite` at the canonical path, with a separate connection per transaction for both same-process and cross-process operations. Add no local mutex or settings lock. Keep JSON authoritative; do not store state, credentials, or lock rows in the database.
- Use a transaction-owned DatabaseSync connection, rollback journal, busy_timeout=0, and BEGIN IMMEDIATE. Retry only numeric primary BUSY=5 with abortable delays of at most 50 ms. Apply one ten-second monotonic budget from the start of SQLite acquisition, including connection setup and polling.
- Never enter the protected operation after timeout or abort. Check the deadline after synchronous calls too. Do not steal a live owner's lock, fall back to unlocked OAuth access, delete databases/journals, use another binding, or access database files through raw file operations.
- Hold ownership across awaits in the protected operation. Attempt close even if rollback fails and report failures safely.
- Implement the local L1–L3 cases in the verification specification. Use real child processes to verify contention on first use and retained databases, separate connections from same-process instances and path aliases, recovery on the same database after forced exit, event-loop progress, abort immediately after acquisition, and non-BUSY/cleanup/module failures. Do not promise interruptible synchronous I/O.

References: [design/oauth-state-locking.md](../design/oauth-state-locking.md), [decisions/sqlite-state-locking.md](../decisions/sqlite-state-locking.md).

## T5 — feat: persist revisioned OAuth and last-write-wins settings

Readiness: Ready  
Dependencies: T4

Outcome: Implement safe state reads, revisioned OAuth commits, and validated last-write-wins settings replacement beneath the Pi agent directory.

Acceptance criteria:

- Use Pi's `getAgentDir()`, respecting its override, and store state in a private `exa-web` child directory. Isolate separate directories. Missing settings mean the default strategy; missing OAuth means no credentials and revision zero, and read-only operations do not create the directory. Add no migration from 0.1.0 or ExaFuse.
- Validate version 1 settings/OAuth envelopes. Unknown versions, malformed JSON/fields, and unreadable files produce storage errors without exposing contents. Do not fall back to the API key when the intended state cannot be read.
- Store SDK tokens/expiry, registration, discovery bound to the validated issuer/resource, and login-required state in the OAuth record. Pin the SDK 2.0.0 representation with fixtures. Do not persist API keys, authorization URLs/codes, verifiers, or OAuth state.
- Under the OAuth lock, reload the latest OAuth state and increment its revision before writing. Settings have only version and strategy: validate existing settings and the proposed JSON, then replace the whole record without a revision, lock, or SQLite access. Concurrent valid settings writes use last-write-wins by successful replacement order, not command start or notification order; do not merge or report a revision conflict.
- For both records, write and close an operation-owned restricted temporary file in the same directory, then rename it. On rename failure, do not retry, delete the target, or fall back to truncation. The failed operation must not alter the target or committed memory; another settings writer may still commit successfully. Clean up only temporary files owned by the failed operation.
- Support revisioned null credentials for logout. A login expected-revision mismatch returns storage-conflict and preserves newer state. Do not rewrite revisions for calls that leave state unchanged.
- Verify POSIX directory mode 0700 and secret/temporary file mode 0600 before saving secrets. Use the Pi directory's inherited ACLs on Windows. Support local filesystems only and make no power-loss durability claim.
- Test complete reads, write/rename failures, unchanged memory after failed commits, OAuth revision conflicts, and independence between settings, OAuth, and separate directories. Verify same-process and cross-process settings races in controlled replacement order, preservation of another writer's result on failure, and settings access with SQLite unavailable or the OAuth lock held. This ticket owns the L5 storage boundaries other than token rotation.

References: [proposals/oauth-state.md#persistence-and-multiple-pi-processes](../proposals/oauth-state.md#persistence-and-multiple-pi-processes).

## T6 — feat: add saved routing strategies and bounded credit fallback

Readiness: Ready  
Dependencies: T3, T5

Outcome: Let users select either strategy with anonymous/API-key configurations, with 402-only reverse fallback and accurate display.

Acceptance criteria:

- Register strategy display/settings under a single `/exa` command. Invalid arguments leave state unchanged; report success only after commit. Add no strategy environment variable.
- Read settings at the start of each logical call, resolve the saved value or anonymous-first default, and retain that snapshot through all attempts. Another process's changes take effect on the next call.
- authenticated-first prefers a usable API key, otherwise anonymous. anonymous-first uses T3's cooldown. T9 adds OAuth credential resolution.
- For authenticated `isError: true` results from either tool, classify only when the first text block begins with the invoked tool's name followed by ` error (402):` or ` error (429):`. A 402 allows one unused anonymous fallback; a 429 allows neither retry nor fallback. Do not replay near misses such as raw HTTP 402, anonymous responses, another tool's name, leading text, later blocks, or natural-language errors.
- Allow one primary and at most one fallback. Anonymous → authenticated → 402 stops. Authenticated → anonymous → 429 permits only the bounded probe, without returning to authentication. An authenticated primary selected during cooldown may also fall back to anonymous on 402.
- Include actual auth and, only when needed, `fallback: {from, to, reason}` in Pi details. Do not label primary selection during cooldown as fallback. Show the route when collapsed and the reason when expanded, without adding explanations to successful text.
- Use the real SDK to verify both strategies with and without a key, all classifier near misses, parallel metadata, final failure code/retryAt, and budget composition with session recovery.

References: [proposals/oauth-routing.md#pi-contract-and-management](../proposals/oauth-routing.md#pi-contract-and-management), [proposals/oauth-routing.md#strategy-and-retry-contract](../proposals/oauth-routing.md#strategy-and-retry-contract), [proposals/oauth-routing.md#authenticated-tool-error-boundary](../proposals/oauth-routing.md#authenticated-tool-error-boundary).

## T7 — feat: stage and validate explicit OAuth login before commit

Readiness: Ready  
Dependencies: T2, T5

Outcome: Complete and validate authentication through a private SDK-based login operation, replacing existing credentials only on success. T10 exposes it through Pi UI.

Acceptance criteria:

- Use the SDK OAuthClientProvider and auth()/finishAuth(), delegating discovery, PKCE, registration, exchange, and issuer/resource validation. Exercise the real SDK with local fake authorization/MCP services.
- Bind port 0 on `127.0.0.1` before constructing the exact redirect URI. Reuse a saved registration only if it permits that URI; stage a replacement when needed. Declare authorization-code and refresh-token grants.
- Keep the verifier, state, code, and new credentials in memory until completion. Validate callback state before exchange. A five-minute deadline, caller cancellation, and shutdown must close the listener and stop active discovery/exchange/validation.
- Validate by initializing a fresh OAuth transport at `https://mcp.exa.ai/mcp/oauth`, without sending search/fetch, then close that connection. After validation, acquire the OAuth lock and commit only if the starting revision still matches. Do not hold the lock while waiting for browser interaction.
- Discard staging on bind failure, wrong state, denial, callback failure/duplication, timeout, abort, validation failure, or commit failure/conflict. Preserve previous credentials or another process's newer credentials. Clean up listeners/transports on every path.
- Verify that tokens, codes, and authorization URLs do not appear in ordinary errors or logs. Restrict URL display to the transient UI added by T10.

References: [proposals/oauth-state.md#explicit-login](../proposals/oauth-state.md#explicit-login).

## T8 — feat: serialize OAuth refresh and revisioned local logout

Readiness: Ready  
Dependencies: T5

Outcome: Refresh saved OAuth credentials and log out non-interactively without multiple Pi processes consuming the same rotating token.

Acceptance criteria:

- Implement a private refresh transaction that calls SDK refreshAuthorization() with saved, validated metadata/registration. Reload the latest revision after acquiring the OAuth lock and reuse another process's update when usable.
- Hold the lock from remote refresh through JSON commit, staging SDK token writes. Retain the existing refresh token when the replacement is omitted. Do not update committed memory before commit succeeds.
- Persist a terminal refresh rejection as login required for that revision to prevent repeated refresh. Transient network failures must not permanently invalidate credentials; later logical calls may retry. Distinguish storage/abort failures from authentication failures.
- A write/rename failure after remote rotation ends with a storage error. Do not retry the old token or fall back to another credential in that operation.
- Logout commits null credentials with an increased revision under lock, then invalidates local OAuth state. Leave strategy/API key unchanged and make no server-side revocation claim.
- Pass caller/lifecycle signals to fetchFn and lock waits. Runtime refresh must not register clients, redirect, open a browser, or enter login through general auth().
- Use a rotating-token fake server and real child processes to verify one proactive refresh, reuse of the new token, refresh/logout races, settings/separate-directory independence during refresh, and persistence failure after rotation. T9 verifies invocation through SDK 401 recovery.

References: [proposals/oauth-state.md#refresh-and-logout](../proposals/oauth-state.md#refresh-and-logout), [proposals/oauth-state.md#oauth-lifecycle](../proposals/oauth-state.md#oauth-lifecycle).

## T9 — feat: use saved OAuth in routing with non-interactive 401 recovery

Readiness: Ready  
Dependencies: T6, T8

Outcome: Prefer OAuth for authenticated access under both strategies, with credential selection and SDK 401 replay bounded by the design.

Acceptance criteria:

- Resolve valid OAuth → refreshable OAuth → API key → unavailable only when authentication is needed. Do not refresh for a successful anonymous primary. Cover missing, expired, and terminal token states in the specified selection cases.
- Read the latest revision before authenticated selection and before using a cached OAuth connection. Invalidate stale local state/connections when it changes. Already-sent requests may finish.
- Send only SDK Bearer authentication to the OAuth endpoint and only x-api-key on the key connection; never combine them in one request. Apply the lazy connection, deduplication, cancellation, and close contracts to OAuth connections.
- Connect runtime AuthProvider token() and onUnauthorized() to T8's transaction. Carry the request's credential revision and signal, and reuse another process's new token. Set onInsufficientScope to throw.
- Allow alternate credential selection only for OAuth authentication or refresh network failures before a tool send. After a tool send, allow one SDK-managed recovery on OAuth for 401. Final 401, refresh failure, and 403 must not switch routes. Storage, lock timeout, conflict, and abort also prohibit fallback.
- Add actual auth/fallback details and display for OAuth. Verify through the real SDK that anonymous probes, session reconnection, OAuth 401, and the one-fallback limit do not reset each other's counters.
- Verify two-process refresh through 401 recovery under L4. Ordinary tool calls must invoke zero authorization/browser callbacks, and provider/helper failures must not enter login staging.

References: [proposals/oauth-routing.md#authenticated-credential-resolution](../proposals/oauth-routing.md#authenticated-credential-resolution), [proposals/oauth-state.md#oauth-lifecycle](../proposals/oauth-state.md#oauth-lifecycle).

## T10 — feat: expose OAuth management through the local Pi TUI

Readiness: Ready  
Dependencies: T7, T9

Outcome: Integrate `/exa login/logout/status` with the existing strategy command so users can manage the full OAuth lifecycle through Pi.

Acceptance criteria:

- Start login only in local TUI mode. Other modes provide guidance to log in through local interactive Pi using the same agent directory, without starting a listener/browser. Saved credentials and non-interactive refresh remain usable in other modes.
- Display the authorization URL only in transient Pi command UI and open a browser when supported. Keep the URL usable if browser opening fails. Do not expose it through assistant messages, LLM tools, or persisted tool results.
- Support UI cancellation and safely present five-minute timeout, callback failure, failed re-login, and commit conflict. Preserve newer revisions in login/logout/refresh races.
- Status uses local reads without network access to show strategy, OAuth state (not configured, locally ready, expired/refreshable, or login required), key presence, and the locally selectable authenticated route. Do not claim to know balances or remote token validity.
- Report logout success after T8's commit and invalidate the local OAuth connection. Preserve the key and strategy, and make the next call follow the latest state.
- Connect Pi shutdown/reload to cleanup of login, active calls, refresh, lock waits, delays, callback listeners, and every connection. Preserve idempotent close and the one-second session-termination grace.
- Verify command/tool/shutdown registration through the real Pi loader. Use local fixtures to verify TUI/mode restrictions, UI cancellation, shutdown at each stage, exclusion of secrets from persisted conversations, and login/logout/refresh races.

References: [proposals/oauth-routing.md#pi-contract-and-management](../proposals/oauth-routing.md#pi-contract-and-management), [proposals/oauth-routing.md#connection-and-cancellation](../proposals/oauth-routing.md#connection-and-cancellation), [plans/oauth-verification.md#feature-cases](oauth-verification.md#feature-cases).

## T11 — ci: verify SQLite state on supported operating systems and runtimes

Readiness: Ready  
Dependencies: T5

Outcome: Run the local SQLite/JSON checks continuously on the accepted operating systems and minimum Node version.

Acceptance criteria:

- Use the package's declared Node 24 development runtime on Linux x64, macOS arm64, and Windows x64, plus Node 24.15.0 on Linux. Use Vite+ and verify the actual executable version.
- Run L1–L3 and JSON replacement and settings last-write-wins regressions in each job. Verify node:sqlite loading through the actual Pi package loader rather than substituting unit mocks.
- Retain normal check/test coverage and verify lock recovery and write-failure results on each OS. Do not weaken existing expectations to accommodate a platform.
- Do not expand the matrix to network filesystems or additional Node generations. Do not describe synchronous I/O as having a hard deadline.

References: [plans/oauth-verification.md#runtime-and-package-checks](oauth-verification.md#runtime-and-package-checks), [design/oauth-state-locking.md](../design/oauth-state-locking.md).

## T12 — docs: prepare verified OAuth and routing behavior for v0.2.0

Readiness: Ready  
Dependencies: T10, T11

Outcome: Reflect implemented behavior in user/engineering documentation and package contents, and establish local release readiness for 0.2.0.

Acceptance criteria:

- Document commands, strategies, OAuth precedence, local TUI login, non-interactive use, state protection/recovery, local logout, probe/cooldown changes, startup key reading, and initialization headers in README.
- Document Node >=24.15.0, SQLite's release-candidate and lazy-loading constraints, synchronous I/O limits, local-filesystem-only support, and the distinction between POSIX modes and Windows inherited ACLs.
- Update product, architecture, tool/authentication contracts, quality guidance, plans, and the SQLite decision's implementation status according to evidence. Retain an unverified Hosted status when applicable. Require an isolated agent directory for anonymous release smoke tests so saved OAuth cannot affect them.
- Map verification-specification feature cases, L1–L5, and settings replacement cases to their responsible tests and confirm all local/runtime results. Fill gaps in the relevant feature tests without duplicating suites for the same obligation.
- Verify `vp run check`, `vp run test`, `vp pm pack -- --dry-run --json`, and the real Pi extension loader. Publish only required TypeScript source, metadata, README, and license. Exclude fixtures, state, secrets, server runtime dependencies, and generated dist.
- Prepare a minor Changeset for the 0.2.0 release intent without duplicating Changesets from implementation PRs. Do not edit version/CHANGELOG manually. T14 handles publication.

References: [plans/oauth-routing.md#5-release-preparation](oauth-routing.md#5-release-preparation), [quality.md](../quality.md), [releases.md](../releases.md), [.changeset/README.md](../../../.changeset/README.md).

## T13 — test: verify Hosted OAuth login and refresh before release

Readiness: Ready  
Dependencies: T10; execution requires operator access to an Exa account and an explicit login action

Outcome: Verify login, refresh after restart, and both OAuth tools against Hosted production, recording evidence for the release condition.

Acceptance criteria:

- Use an isolated local Pi agent directory, unset EXA_API_KEY, and use the actual `/exa` command and Pi tools. Require `PI_EXA_WEB_LIVE_TEST=1` for scripted external checks.
- Have the operator log in and confirm callback completion and authenticated initialization. Check token/refresh-token presence without recording values.
- Run one search under authenticated-first. Restart Pi with the same directory, perform a real refresh using the issued refresh token, and run one fetch. Confirm success and oauth details. Use a documented test-only local expiry override if needed.
- If no refresh token is issued, do not mark refresh verified; stop the release and reconsider the claim. Lack of account access also leaves this ticket incomplete. The checks and pass/fail criteria themselves have no unresolved definitions.
- Allow at most four OAuth tool sends including retries, normally two. Stop on unexpected behavior. Do not deliberately trigger 401/429, exhaust credits, or wait for natural expiry.
- Verify status/logout and credential cleanup. Record only the date, SDK version, login outcome, restart/refresh result, and effective routes. Do not record URLs, codes, tokens, keys, queries, results, or network dumps. Run the anonymous smoke only once through T14's release procedure.

References: [plans/oauth-verification.md#hosted-oauth-release-smoke](oauth-verification.md#hosted-oauth-release-smoke).

## T14 — chore: verify the v0.2.0 release and first managed publication

Readiness: Ready  
Dependencies: T12, T13; publication requires separate explicit release/deployment approval

Outcome: Publish the approved 0.2.0 release through Changesets/OIDC and verify the registry-installed package in Pi. If this is the first managed publication, also complete the existing independent automation verification through this release.

Acceptance criteria:

- Review version 0.2.0, consumed Changesets, the GitHub-linked changelog, and required CI in the Changesets release PR. Do not edit version/CHANGELOG manually.
- Follow the release procedure: inspect the verify job's check/test/pack results, then obtain separate approval before proceeding with npm-production. Use OIDC without adding a long-lived npm token.
- Confirm consistency among npm version/latest/provenance, the Git tag, GitHub Release, CHANGELOG, publication commit, and published file list.
- Install the exact registry version in a clean Pi package directory. With an isolated agent directory and EXA_API_KEY unset, run one anonymous search and one anonymous fetch. Do not deliberately consume quota to trigger 429.
- For the first Changesets-managed publication, record evidence from release-PR generation through post-publication verification and update the existing automation plan's completion status. If another release already verified it, do not publish an extra release.
- Keep evidence in a release record. Do not mark release verification complete while post-publication smoke tests remain incomplete. Agreement to carry out a ticket does not authorize publication.

References: [releases.md](../releases.md), [plans/changesets-release-automation.md](changesets-release-automation.md).

## Coverage and exclusions

- Implementation-plan coverage: stage 1 by T1–T2; stage 2 by T3/T6/T9; stage 3 by T4–T5/T7–T9; stage 4 by T6/T9/T10; stage 5 by T11–T14.
- The storage work starting at T4 and connection work starting at T2 can progress independently and meet at T6/T7/T9. T7 and T8 have separate outcomes; T9 can use saved-state fixtures without waiting for T7's login/UI work. T13 does not wait for T12 documentation. Dependencies contain no cycles.
- All 14 tickets are Ready. There are no Definition Blocked or Unresolved, not ticketed items. Hosted account access and publication approval are explicit execution conditions, distinct from new design decisions.
- Excluded: multiple accounts, keychains, remote callback relays/SSH forwarding, network filesystems, provider extensions, a public SDK, arbitrary routing/retry settings, a new build step, and credential migration from ExaFuse. Obtain separate approval for publication.
