# OAuth and Routing Verification

**Status:** Required checks for accepted `0.2.0` design; not executed for this feature

This document owns local acceptance cases, runtime coverage, and the Hosted release smoke for the [implementation plan](oauth-routing.md). The accepted [routing design](../proposals/oauth-routing.md), [state design](../proposals/oauth-state.md), and [SQLite lock contract](../design/oauth-state-locking.md) supply the expectations. Design acceptance does not establish implementation or successful verification.

## Local Verification

Normal tests use local fake services, fake time for delays, synchronization barriers for concurrency, and real child processes where isolation matters. Derive synthetic 402/429 fixtures from the design's pinned formatter sources. Tests must not contact Exa or open a browser. Test behavior and boundary failures rather than private class names or file layout.

## Feature Cases

| Area | Required assertions |
| --- | --- |
| Public Pi contract | Same names, bounds, single URL, optional omission, success text; `oauth` and optional fallback details; actual route under parallel calls; cancelled/error rendering. |
| Primary selection | Both strategies with no credentials, key only, OAuth only, both credentials, refreshable/terminally invalid OAuth; anonymous success does not refresh OAuth. |
| Anonymous 429 | Short/zero/past/long header delays; numeric/date Retry-After; seconds/milliseconds reset; header precedence and malformed headers; one no-header probe; second-429 final deadline; no credential alternative. |
| Cooldown | Active/deadline expiry, success reset, repeated no-header doubling/cap, same-generation parallel failures, authenticated primary versus fallback metadata, bypass when no usable authenticated route exists. |
| Authenticated 402/429 | Both tools and both credential routes; exact first-text prefixes with `isError`; 402 permits one fallback, 429 permits neither retry nor fallback; HTTP 429 optionally carries retry time. |
| Classifier near misses | Anonymous route, wrong invoked tool, missing/false `isError`, leading whitespace/text, later text block, embedded status/tag, unsupported status, altered prefix, natural-language credit/free-tier 429; none triggers replay. Raw HTTP 402 is not the accepted text boundary. |
| Retry budget | Anonymous → authenticated → 402 stops; authenticated → anonymous → 429 cannot return to authentication; combine session expiry, anonymous probing, and OAuth 401 without resetting limits. |
| No replay | Final 401/403, authenticated 429, 5xx, network failure, non-session 404, unmatched MCP errors, abort, and local storage errors; preserve final failure code/retry time. |
| OAuth | Valid/expired tokens, missing refresh token, invalid_grant versus transient refresh failure, API-key selection only before tools/call, one SDK 401 recovery, insufficient-scope throw, runtime AuthProvider/helper errors cannot enter login or mutate staged login state; zero ordinary-call browser/authorization callbacks. |
| Login lifecycle | Port 0, exact redirect registration replacement, bind failure, wrong state, denial, callback failure/duplicate, timeout, user abort, validation failure, failed re-login preservation, cleanup and commit conflict. |
| Persistence | Lock/state cases below, plus revisioned logout, unknown version/corruption, failed strategy write, last committed settings visible on next call, and status without network. |
| Connection lifecycle | Per-route lazy creation and connect deduplication; independent waiter cancellation; partial initialization cleanup; SDK HTTP abort; stale OAuth connection invalidation; session-context-only recovery; close/repeated close/calls after close. |
| Cancellation composition | Abort during discovery, token access/refresh, lock acquisition, callback wait, anonymous delay, tool HTTP, and shutdown; preserve internal abort reason and never fallback. Shared initialization remains usable by surviving waiters. |
| Secret handling | Inject sentinel secrets in headers, nested errors, causes, formatter suffixes, authorization URLs, and storage failures; none appears in Pi errors/details, status, logs, or persisted conversation records. Successful Exa text contract is tested separately. |
| Pi modes and package | TUI login and cancellation; other modes refuse interactive login before side effects but use saved credentials; loader registration includes management/shutdown; source-only npm artifact. |

## Lock and State Cases

Verify the accepted SQLite lock contract. Reuse feature fixtures for L4–L5; each obligation needs one test location.

| Group | Required assertions |
| --- | --- |
| L1: Runtime loading and contention | Load `node:sqlite` through the actual package/Pi loader. Two processes racing first use of an absent coordination DB must admit only one protected operation; confirm numeric BUSY classification, event-loop progress while polling, and acquisition after release. Repeat against the retained DB. Exercise same-process instances and canonical path aliases. |
| L2: Transaction lifetime and recovery | Hold ownership across an awaited operation and JSON replacement; a contender must remain excluded. Verify acquisition after ordinary cleanup and forced owner exit using the same DB path, without manual deletion. Use synchronization messages and a generous recovery deadline rather than asserting instantaneous OS cleanup. |
| L3: Bounded waits and cleanup | Abort/timeout during local-mutex wait or polling never enters later. Abort observed immediately after synchronous acquisition cleans up before entering. Fake time checks the combined budget. Inject module-unavailable, non-BUSY, rollback, and close failures; verify safe error propagation and best-effort cleanup without fallback or stale-file deletion. Do not claim synchronous I/O itself is interruptible. |
| L4: Transaction integration | Use the rotating-token fake server to verify one refresh across two Pi processes and reuse of the committed token, for proactive and SDK-401 recovery. Login/logout/refresh races retain revision conflict semantics. A held OAuth lock does not block settings or a separate directory. |
| L5: Commit failure integration | Verify complete reads across replacement, failed write/rename, unchanged committed memory on failed commit, and remote token rotation followed by persistence failure. Assert lock cleanup and no alternate-credential fallback. |

## Runtime and Package Checks

- Run L1–L3 on Linux x64, macOS arm64, and Windows x64 at the declared Node 24 development runtime, plus Linux at the minimum Node 24.15.0. Include JSON replacement regression in the OS jobs. The current CI is Linux-only. Use Vite+ and verify the actual executable version; expand the matrix only for a concrete mismatch.
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
