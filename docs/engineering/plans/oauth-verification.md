# OAuth and Routing Verification

**Status:** PR1–PR4 merged with CI verified; PR5 interactive login/management verified locally on development/minimum Node, PR CI pending; Hosted smoke pending

This document owns local acceptance cases, runtime coverage, and the Hosted release smoke for the [implementation plan](oauth-routing.md). The accepted [routing design](../proposals/oauth-routing.md), [state design](../proposals/oauth-state.md), and [SQLite lock contract](../design/oauth-state-locking.md) supply the expectations. Design acceptance does not establish implementation or successful verification.

## Local Verification

Normal tests use local fake services, fake time for delays, synchronization barriers for concurrency, and real child processes where isolation matters. Derive synthetic 402/429 fixtures from the design's pinned formatter sources. Tests must not contact Exa or open a browser. Test behavior and boundary failures rather than private class names or file layout.

## Feature Cases

| Area | Required assertions |
| --- | --- |
| Public Pi contract | Same names, bounds, single URL, optional omission, success text; `oauth` and optional fallback details; actual route under parallel calls; cancelled/error rendering. |
| Primary selection | Both strategies with no credentials, key only, OAuth only, both credentials, refreshable/terminally invalid OAuth; anonymous success does not refresh OAuth. |
| Anonymous 429 | Short/zero/past/long header delays; numeric/date Retry-After; seconds/milliseconds reset; header precedence and malformed headers; one no-header probe; second-429 final deadline; no credential alternative. |
| Cooldown | Active/deadline expiry, success reset, fixed one-second duration across repeated no-header failures, parallel failures preserving a later active deadline, authenticated primary versus fallback metadata, bypass when no usable authenticated route exists. |
| Authenticated 402/429 | Both tools and both credential routes; exact first-text prefixes with `isError`; 402 permits one fallback, 429 permits neither retry nor fallback; HTTP 429 optionally carries retry time. |
| Classifier near misses | Anonymous route, wrong invoked tool, missing/false `isError`, leading whitespace/text, later text block, embedded status/tag, unsupported status, altered prefix, natural-language credit/free-tier 429; none triggers replay. Raw HTTP 402 is not the accepted text boundary. |
| Retry budget | Anonymous → authenticated → 402 stops; authenticated → anonymous → 429 cannot return to authentication; combine session expiry, anonymous probing, and OAuth 401 without resetting limits. |
| No replay | Final 401/403, authenticated 429, 5xx, network failure, non-session 404, unmatched MCP errors, abort, and local storage errors; preserve final failure code/retry time. |
| OAuth | Valid/expired tokens, missing refresh token, invalid_grant versus transient refresh failure, API-key selection only before tools/call, one SDK 401 recovery, insufficient-scope throw, runtime AuthProvider/helper errors cannot enter login or mutate staged login state; zero ordinary-call browser/authorization callbacks. |
| Login lifecycle | Port 0, exact redirect registration replacement, bind failure, wrong state, denial, callback failure/duplicate, timeout, user abort, validation failure, failed re-login preservation, cleanup and commit conflict. |
| Persistence | Lock/state cases below, plus revisioned logout, unknown version/corruption, failed strategy write, last successfully replaced settings visible on the next call with a stable in-flight snapshot, and status without network. |
| Connection lifecycle | Per-route lazy creation and connect deduplication; independent waiter cancellation; partial initialization cleanup; SDK HTTP abort; stale OAuth connection invalidation; session-context-only recovery; close/repeated close/calls after close. |
| Cancellation composition | Abort during discovery, token access/refresh, lock acquisition, callback wait, anonymous delay, tool HTTP, and shutdown; preserve internal abort reason and never fallback. Shared initialization remains usable by surviving waiters. |
| Secret handling | Inject sentinel secrets in headers, nested errors, causes, formatter suffixes, authorization URLs, and storage failures; none appears in Pi errors/details, status, logs, or persisted conversation records. Successful Exa text contract is tested separately. |
| Pi modes and package | TUI login and cancellation; other modes refuse interactive login before side effects but use saved credentials; loader registration includes management/shutdown; source-only npm artifact. |

PR1 connection and safe-error regressions remain in `tests/exa-mcp-client.test.ts`, and the public Pi contract remains in `tests/index.test.ts`. PR3 extends them as follows:

| PR3 cases | Test source |
| --- | --- |
| Probe timing, final deadline, fixed cooldown, concurrent deadlines, reset, missing key, one fallback and cancellation | `tests/anonymous-first.test.ts` with fake time and synchronization barriers |
| Both tools/strategies with or without a key, exact 402/429 boundaries and near misses, successful text preservation, concurrent auth/fallback metadata, session recovery budget composition | `tests/exa-mcp-client.test.ts` with the real SDK and local HTTP fixture |
| Settings snapshots and another process's change on the next call | `tests/exa-mcp-client.test.ts` and the existing settings worker |
| Optional fallback details and collapsed/expanded display | `tests/index.test.ts` |
| `/exa` registration, invalid arguments, commit-before-notification, safe replacement failures, shutdown during saving, corrupt settings before network | `tests/strategy-command.test.ts` with the real Pi loader |
| Settings usable with SQLite disabled; settings/OAuth errors excluded from rendering, logs and persisted sessions | `tests/state-store.test.ts` child fixture and `tests/state-loader.test.ts` |

PR3 local evidence (2026-09-09): Linux x64 passed all 211 tests on Node 24.19.0 and 24.15.0; the minimum run asserted its actual runtime/platform/architecture. Formatting, lint and types passed. Minimum validation used `vp env use 24.15.0` then built-in `vp check` / `vp test`; `vp env exec` alone did not select the test runtime. The override was removed after validation. `vp pm pack -- --dry-run --json` listed only LICENSE, package metadata, README and required TypeScript source. The suite includes real Pi loader and persisted-error checks. [PR3's four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34329770811) for `189ab6a`, including macOS arm64 and Windows x64. The final PR3 revision `a0b32de` also passed [all four jobs](https://github.com/hudrazine/pi-exa-web/actions/runs/34330004672), and PR #17 merged as `346f0f8`. PR4 adds the OAuth checks below.

## PR4 Verification

| PR4 obligation | Test source |
| --- | --- |
| Expiry, saved issuer/client/discovery, omitted refresh token/expiry, terminal rejection and transient retry | `tests/oauth-state.test.ts` with real SDK refresh and SQLite |
| Both tools, lazy OAuth reads, credential precedence, header separation, 401 recovery, classifier near misses and final failure evidence | `tests/oauth-routing.test.ts` with HTTPS-origin fetch forwarding to local HTTP |
| L4 proactive and 401 exclusion across two actual processes, one rotating-token refresh and committed-token reuse | `tests/oauth-process.test.ts` and `tests/fixtures/oauth-worker.ts` |
| L5 remote rotation then failed write/rename, storage precedence over refresh errors, no alternate selection after commit failure | `tests/oauth-state.test.ts`, `tests/oauth-routing.test.ts` |
| Revision retirement, sent-user completion, logout during initialization (including cancellation of its sole waiter), lock/HTTP/init cancellation and three-session shared grace | `tests/oauth-routing.test.ts`; refresh/logout ordering in `tests/oauth-state.test.ts` |
| OAuth details and expanded fallback display, unchanged success text, tokens/challenges/causes/storage secrecy in actual Pi sessions | `tests/index.test.ts`, `tests/oauth-boundary.test.ts` |

PR4 local evidence (2026-09-10): Linux x64 passed all 296 tests on Node 24.19.0 and Node 24.15.0, with runtime/platform/architecture assertions. Formatting, lint and types passed. Minimum validation used `vp env use 24.15.0` with built-in `vp check` / `vp test`; the override was then removed. Development validation used `vp run check` / `vp run test`. Pack dry run listed only LICENSE, package metadata, README and required TypeScript source, including the private OAuth manager. Real Pi loader/rendering/SessionManager checks are included in the suite. Normal fixtures allow only the saved HTTPS MCP/token URLs and redirect them to a local server; they do not relax the storage schema or contact Hosted Exa. [All four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34374575956) for `dd6da10`, including macOS arm64 and Windows x64. [PR #19](https://github.com/hudrazine/pi-exa-web/pull/19) merged as `b21738f`; T8/T9 are Done. Hosted smoke remains pending.

## PR5 Verification

| PR5 obligation | Test source |
| --- | --- |
| Discovery, registration, exact redirect/issuer reuse, declared grants, SDK scope and PKCE, state/code/issuer callback validation, staged schema and connection validation, commit and both tools/strategies | `tests/oauth-login.test.ts`, `tests/fixtures/login-server.ts` with HTTPS-only fetch forwarding |
| SSE initialization without EOF, caller/shutdown during a pending SSE initialize request, closed streams and preserved committed state | `tests/oauth-login.test.ts` with the real SDK and open SSE fixture in `tests/fixtures/oauth-server.ts` |
| Bind failure, wrong/duplicate parameters or callback, denial, unsafe authorization URL, failed exchange/initialization/re-login, write/rename/cleanup failure, no staged connection exposure | `tests/oauth-login.test.ts` |
| Five-minute deadline, caller/shutdown at discovery/register/exchange/validation/callback/lock wait, pre-commit abort and successful-rename boundary, three-route shared termination grace | `tests/oauth-login.test.ts`; deadline callback is injected only for the exact 300,000 ms timer, leaving local HTTP clocks running |
| Same-client login rejection, independent-client races, other-process login/refresh/logout revision conflicts and settings independence during browser wait | `tests/oauth-login.test.ts`, `tests/login-process.test.ts`, `tests/fixtures/login-worker.ts` |
| Actual loader, unchanged tools/shutdown, command validation, TUI/RPC/JSON/print gate, temporary URL, cancel/dispose/timeout, browser failure, notifications after commit, local status states and logout | `tests/management-command.test.ts`, existing `tests/strategy-command.test.ts`; browser launch is intercepted, never executed |
| Status without network, file creation or SQLite; startup key presence, expiry/login-required precedence and lifecycle rejection | `tests/management-command.test.ts`, SQLite-disabled child in `tests/state-store.test.ts` / `tests/fixtures/state-worker.ts` |
| Authorization URL, state, verifier, codes, tokens, secrets, SDK errors and nested causes absent from notices, errors, logs and actual SessionManager records | `tests/management-command.test.ts`, `tests/oauth-login.test.ts`; PR4 OAuth renderer/boundary regressions retained |

PR5 local evidence (2026-09-10): Linux x64 passed all 355 tests on Node 24.19.0 and 24.15.0, with actual test-process Node/OS/CPU assertions, the real Pi loader and child processes. Formatting, lint and types passed. Development used `vp run check` / `vp run test`; minimum validation used `vp env use 24.15.0` with built-in `vp check` / `vp test`, then removed the override. Pack dry run listed only LICENSE, package metadata, README and required TypeScript source, including the private login and command modules. PR5's four OS/runtime CI jobs have not run; local Linux success does not establish macOS/Windows success. Hosted Exa, a real browser, release PR #18, version/CHANGELOG changes and npm publication are outside this work. T7/T10 must not be marked Done before PR5 CI and merge.

## Lock and State Cases

PR2 coverage: `tests/state-store.test.ts` exercises L1–L2 with real child processes and SQLite, the JSON portion of L5, and settings replacement. `tests/oauth-lock.test.ts` covers L3 with controlled clocks and dependency failures. `tests/state-loader.test.ts` verifies SQLite through a test extension loaded by Pi's actual loader, the production entry and strategy command, safe storage errors through rendering/SessionManager, and CI runtime identity. PR4 covers proactive and 401-triggered L4 in `tests/oauth-process.test.ts`, and remote rotation/write/rename failures in `tests/oauth-state.test.ts` and `tests/oauth-routing.test.ts`. PR5 covers login-related conflicts and save failures in `tests/oauth-login.test.ts` and `tests/login-process.test.ts`. PR2–PR4 passed their four-job CI before merge.

PR2 local evidence (2026-09-09): Linux x64 passed all 156 tests on Node 24.19.0 and 24.15.0, with test-process runtime assertions. Formatting, lint and types passed on both runtimes. The minimum run used `vp env use 24.15.0` followed by built-in `vp check` / `vp test`; development used `vp run check` / `vp run test`. `vp pm pack -- --dry-run --json` listed only LICENSE, package metadata, README and required `src/*.ts`. Real Pi loader and persisted storage-error checks are included in the suite. [All four CI jobs passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34322919016) for `5f24625`, including macOS arm64 and Windows x64. [PR #16](https://github.com/hudrazine/pi-exa-web/pull/16) merged as `d9b84f9`; T4/T5/T11 are Done.

Verify the accepted SQLite lock contract. Reuse feature fixtures for L4–L5; each obligation needs one test location.

| Group | Required assertions |
| --- | --- |
| L1: Runtime loading and contention | Load `node:sqlite` through the actual package/Pi loader. Two processes racing first use of an absent coordination DB must admit only one protected operation; confirm numeric BUSY classification, event-loop progress while polling, and acquisition after release. Repeat against the retained DB. Exercise separate connections from same-process instances and canonical path aliases, with no local mutex. |
| L2: Transaction lifetime and recovery | Hold ownership across an awaited operation and JSON replacement; a contender must remain excluded. Verify acquisition after ordinary cleanup and forced owner exit using the same DB path, without manual deletion. Use synchronization messages and a generous recovery deadline rather than asserting instantaneous OS cleanup. |
| L3: Bounded waits and cleanup | Abort/timeout during SQLite acquisition or polling never enters later. Abort observed immediately after synchronous acquisition cleans up before entering. Fake time checks the acquisition budget including connection setup and polling. Inject module-unavailable, non-BUSY, rollback, and close failures; verify safe error propagation and best-effort cleanup without fallback or stale-file deletion. Do not claim synchronous I/O itself is interruptible. |
| L4: Transaction integration | Use the rotating-token fake server to verify one refresh across two Pi processes and reuse of the committed token, for proactive and SDK-401 recovery. Login/logout/refresh races retain revision conflict semantics. A held OAuth lock does not block settings or a separate directory. |
| L5: Commit failure integration | Verify complete reads across replacement for settings and OAuth, failed write/rename, unchanged committed memory on failed commit, and remote token rotation followed by persistence failure. A failed settings writer must not undo another writer's successful replacement or delete its temporary file. Assert OAuth lock cleanup and no alternate-credential fallback. |
| Settings replacement | Validate version/strategy and reject corrupt, unknown-version, or unreadable existing state without overwriting it. Race two same-process writers and two child-process writers with controlled replacement order; the last successful replacement wins regardless of command start/notification order. Readers see complete valid records, with no revision, merge, or storage-conflict result for concurrent valid writes. Verify settings reads/writes do not load SQLite or create a coordination DB, including when SQLite is unavailable or the OAuth lock is held. |

## Runtime and Package Checks

- Run L1–L3 on Linux x64, macOS arm64, and Windows x64 at the declared Node 24 development runtime, plus Linux at the minimum Node 24.15.0. Include JSON replacement and settings last-write-wins regressions in the OS jobs. PR2 defines this matrix; successful execution on every job is still required. Use Vite+ and verify the actual executable version; expand the matrix only for a concrete mismatch.
- Run `vp run check` and `vp run test`. The real SDK/local server tests must exercise HTTP observation, provider callbacks, signal propagation, and retry composition.
- Inspect `vp pm pack -- --dry-run --json` and load the TypeScript entry through Pi's real extension loader. Verify source-only publication without fixtures, state, secrets, or server runtime dependencies.

## Hosted OAuth Release Smoke

Run once after implementation in an isolated local Pi agent directory with `EXA_API_KEY` unset. Use the actual `/exa` command and Pi tools. Login requires explicit operator action; scripted external checks also require `PI_EXA_WEB_LIVE_TEST=1`.

1. Run `/exa login`; confirm callback completion and authenticated initialization. Record token/refresh-token presence, never values.
2. Select `authenticated-first` and run one search. Verify successful text and `oauth` details.
3. Restart Pi with the same directory. Exercise real refresh using the issued refresh token, then run one fetch. A documented test-only local expiry override may trigger refresh without waiting for natural expiry. If no refresh token is issued, review the refresh-support claim before release; do not mark refresh verified.
4. Check local status/logout and clean up credentials. Verify local state transitions and API-key preservation in the implementation regression suite; they need no extra Hosted requests.

Allow at most four OAuth tool sends including retries; normally two suffice. Stop on unexpected behavior. No deliberate Hosted 401/429, exhausted credits, or natural-expiry wait is required. Reuse the release procedure's anonymous search/fetch smoke rather than duplicating it here.

Record date, SDK version, login outcome, restart/refresh result, and effective routes. Do not record tokens, codes, authorization URLs, API keys, queries, fetched URLs, result text, or network dumps. Account access being unavailable leaves this release condition incomplete.
