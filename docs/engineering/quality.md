# Quality and Development

Changes must preserve the [product requirements](product.md) and the contracts under [design](README.md#understand-the-project). This document owns verification obligations and their test locations. [Execution evidence](records/0.2.0-verification.md) records what has passed; [release procedure](releases.md) owns Hosted and registry smoke.

## Local Workflow

Use Vite+ with the runtime/package-manager versions in [package.json](../../package.json):

```sh
vp install
vp run check
vp run test
```

Check covers formatting, lint and types. There is no build step. Tests use real SDK clients against local HTTP services, fake time for delays, synchronization barriers for concurrency and real child processes where process isolation matters. Preserve HTTPS OAuth storage contracts by forwarding allowed HTTPS fixture URLs to local services in tests. Never contact Hosted Exa or open a real browser during normal checks.

Derive assertions from the contract, not private filenames or class structure. Revalidate OAuth/lifecycle fixtures on SDK upgrades. Test successful text preservation separately from safe error handling, and avoid duplicate suites for the same obligation.

## Feature Coverage

| Area | Required evidence | Existing test source |
| --- | --- | --- |
| Pi contract | Names, schemas, bounds, argument mapping, optional omission, successful content/details, thrown errors | [`tests/index.test.ts`](../../tests/index.test.ts) |
| Display | Pending, success, error, cancellation, collapsed/expanded output, requested-count labels; real Pi `ToolExecutionComponent` coverage without unstable style snapshots | [`tests/index.test.ts`](../../tests/index.test.ts) |
| Authentication policy | Short/long/no-header probes, header parsing, fixed cooldown/parallel deadlines, missing key, bounded bidirectional fallback, abort-aware delay, credential isolation, no retry cycles | [`tests/anonymous-first.test.ts`](../../tests/anonymous-first.test.ts) |
| OAuth state | Refresh expiry/issuer preservation, terminal versus transient rejection, rotation then write/rename failure, cleanup error precedence and logout races | [`tests/oauth-state.test.ts`](../../tests/oauth-state.test.ts) |
| OAuth routing | Both tools/strategies, lazy selection, 401 replay, session-budget composition, auth alternatives, revision retirement and three-route shutdown | [`tests/oauth-routing.test.ts`](../../tests/oauth-routing.test.ts) |
| OAuth process exclusion | Two real processes reuse one remote refresh for proactive expiry and 401 recovery (L4) | [`tests/oauth-process.test.ts`](../../tests/oauth-process.test.ts) |
| OAuth Pi boundary | Production loader, OAuth secrets in failures/causes/challenges/storage, rendering, logs and persisted conversation | [`tests/oauth-boundary.test.ts`](../../tests/oauth-boundary.test.ts) |
| Explicit login | Real SDK discovery/register/PKCE/state/exchange, safe callbacks, temporary read-only validation including SSE before EOF, old-state preservation, cancellation/deadline, commit and connection retirement | [`tests/oauth-login.test.ts`](../../tests/oauth-login.test.ts) |
| Login process races | Earlier login cannot replace another process's committed login, refresh or logout; no lock during browser wait | [`tests/login-process.test.ts`](../../tests/login-process.test.ts) |
| Management UI | Actual loader, TUI versus RPC/JSON/print, temporary URL removal, best-effort browser opening, cancel/dispose/timeout, commit-before-notice, local status and saved-session secrecy | [`tests/management-command.test.ts`](../../tests/management-command.test.ts) |
| SDK integration | Real MCP client/transport against a local server: both strategies and settings snapshots, exact 402/429 classifiers and near misses, intent replay, route-specific headers/sessions, concurrent route/failure evidence, per-route initialization sharing, HTTP cancellation, session-only recovery, in-flight closure, one shared termination grace, repeated shutdown | [`tests/exa-mcp-client.test.ts`](../../tests/exa-mcp-client.test.ts) |

The management suite also verifies fixed argument candidates, whitespace/case/invalid input, descriptions, Pi's actual completion application and absence of completion side effects. Strategy validation, commit-before-notification and safe storage failures use [strategy-command.test.ts](../../tests/strategy-command.test.ts). Settings snapshots, including a child-process write affecting the next call, use the MCP client suite.

## Boundary Cases

Exercise both tools and strategies with no credentials, each credential alone, both credentials, expired/refreshable OAuth and login-required state. Anonymous success must not read OAuth. Check zero/past/2,000 ms/over-limit/no-header probe timing, header precedence and epoch units, the final 429 deadline, concurrent cooldown maxima and success reset.

Classifier cases include exact authenticated 402/429 prefixes and near misses: wrong route/tool, leading text, later block, missing `isError`, natural-language limits and raw HTTP 402. Combine session 404, anonymous probe, OAuth 401 and fallback so no budget resets or third route can appear. Final failures must retain only the final route's code/retry time.

Test cancellation during discovery, exchange, validation, callback wait, refresh, lock acquisition, shared initialization, anonymous delay and tool HTTP. Surviving shared-init waiters must remain usable; abort must never become fallback.

Secret sentinels cover headers, credential-bearing URLs, nested SDK errors/causes, formatter suffixes, tokens/client secrets, challenges, authorization URLs/codes/state/verifiers and storage failures. Verify exceptions, details, display, notifications, logs and actual SessionManager records, not only string conversion. The temporary login screen is the only permitted authorization-URL display. Real Pi loaders exercise production tool/command/shutdown registration; the storage test extension exercises lazy SQLite loading through the same loader.

Login tests include SSE initialization before EOF, cancellation of a pending SSE initialize response, closed streams and preservation of committed state. Browser launch is intercepted. Callback acceptance and committed-login success are separate assertions. Inject the five-minute deadline without replacing real HTTP timing.

## Lock and State Cases

| Group | Required assertions |
| --- | --- |
| L1: Runtime loading and contention | Load `node:sqlite` through the actual package/Pi loader. Two processes racing first use of an absent coordination DB must admit only one protected operation; confirm numeric BUSY classification, event-loop progress while polling, and acquisition after release. Repeat against the retained DB. Exercise separate connections from same-process instances and canonical path aliases, with no local mutex. |
| L2: Transaction lifetime and recovery | Hold ownership across an awaited operation and JSON replacement; a contender must remain excluded. Verify acquisition after ordinary cleanup and forced owner exit using the same DB path, without manual deletion. Use synchronization messages and a generous recovery deadline rather than asserting instantaneous OS cleanup. |
| L3: Bounded waits and cleanup | Abort/timeout during SQLite acquisition or polling never enters later. Abort observed immediately after synchronous acquisition cleans up before entering. Fake time checks the acquisition budget including connection setup and polling. Inject module-unavailable, non-BUSY, rollback, and close failures; verify safe error propagation and best-effort cleanup without fallback or stale-file deletion. Do not claim synchronous I/O itself is interruptible. |
| L4: Transaction integration | Use the rotating-token fake server to verify one refresh across two Pi processes and reuse of the committed token, for proactive and SDK-401 recovery. Login/logout/refresh races retain revision conflict semantics. A held OAuth lock does not block settings or a separate directory. |
| L5: Commit failure integration | Verify complete reads across replacement for settings and OAuth, failed write/rename, unchanged committed memory on failed commit, and remote token rotation followed by persistence failure. A failed settings writer must not undo another writer's successful replacement or delete its temporary file. Assert OAuth lock cleanup and no alternate-credential fallback. |
| Settings replacement | Validate version/strategy and reject corrupt, unknown-version, or unreadable existing state without overwriting it. Race two same-process writers and two child-process writers with controlled replacement order; the last successful replacement wins regardless of command start/notification order. Readers see complete valid records, with no revision, merge, or storage-conflict result for concurrent valid writes. Verify settings reads/writes do not load SQLite or create a coordination DB, including when SQLite is unavailable or the OAuth lock is held. |

| Obligation | Test source |
| --- | --- |
| L1: first/retained DB contention, same-process connections, canonical aliases and actual loader | [state-store.test.ts](../../tests/state-store.test.ts), [state-loader.test.ts](../../tests/state-loader.test.ts) |
| L2: ownership across await/rename, normal release and forced owner exit | [state-store.test.ts](../../tests/state-store.test.ts) and synchronized state workers |
| L3: setup-inclusive deadline, abort immediately after acquisition, BUSY versus other errors, unavailable module and rollback/close failure | [oauth-lock.test.ts](../../tests/oauth-lock.test.ts) |
| L4: one remote refresh for proactive/401 recovery across two processes | [oauth-process.test.ts](../../tests/oauth-process.test.ts); login/refresh/logout conflicts in [login-process.test.ts](../../tests/login-process.test.ts) |
| L5: complete records, failed commit and remote rotation, no old-token resend or alternate selection | [state-store.test.ts](../../tests/state-store.test.ts), [oauth-state.test.ts](../../tests/oauth-state.test.ts), [oauth-routing.test.ts](../../tests/oauth-routing.test.ts), [oauth-login.test.ts](../../tests/oauth-login.test.ts) |
| Settings independence, controlled same/child-process replacement ordering, permissions and SQLite-disabled access | [state-store.test.ts](../../tests/state-store.test.ts), [state-loader.test.ts](../../tests/state-loader.test.ts) |

These fixtures verify local transaction composition and rotating-token behavior; they do not prove Hosted refresh-token issuance.

## Runtime and Package Checks

The [CI workflow](../../.github/workflows/ci.yml) runs `vp run check` and `vp run test` on Linux x64, macOS arm64 and Windows x64 using the declared development runtime. Tests assert their effective Node version, OS and CPU. Local Linux results do not substitute for another platform; require successful checks on the final PR revision.

The supported Node minimum remains 24.15.0, but CI does not separately test that minimum.

For package changes, run `vp pm pack -- --dry-run --json` and verify loading through Pi's real extension loader. The artifact must contain only LICENSE, README, package.json and required TypeScript source: no tests, fixtures, local state, secrets, server runtime dependencies or generated distribution. Use `vp run changeset status` to inspect release intent without generating versions.

Local/CI/package success does not establish Hosted compatibility or authorize publication. The [remaining release gates](plans/oauth-tickets.md) track those separately.
