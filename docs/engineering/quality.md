# Quality and Development

Changes must preserve the [product requirements](product.md) and [design contracts](README.md#understand-the-project). This document defines verification obligations and where to test them. [Release procedure](releases.md) owns Hosted and registry checks; [release records](README.md#historical-evidence) preserve actual results.

## Local Workflow

Use Vite+ with the runtime and package-manager versions in [package.json](../../package.json):

```sh
vp install
vp run check
vp run test
```

Check covers formatting, lint and types. There is no build step. Normal checks never contact Hosted Exa or open a real browser.

Use real SDK clients against local HTTP services, fake time for policy delays, explicit synchronization for concurrency and child processes for process isolation. Forward allowed HTTPS fixture URLs to local services to preserve OAuth storage validation. A concurrent start is not proof that both operations reached the same wait; establish the precondition before releasing a fixture response.

Derive assertions from contracts rather than private filenames or class structure. Test successful text preservation separately from error secrecy. Revalidate OAuth and connection fixtures on SDK upgrades. Do not duplicate suites for the same obligation.

## Tool, Routing and Management Coverage

| Responsibility | Evidence | Test source |
| --- | --- | --- |
| Pi tool boundary | Names, schemas, bounds, argument mapping, optional omission, text/details, thrown errors and requested-versus-returned counts; pending/success/error/cancellation and collapsed/expanded rendering through the real Pi component, without unstable style snapshots | [index.test.ts](../../tests/index.test.ts) |
| Routing policy | Both strategies, anonymous probes/cooldown, credential selection, bounded fallback and cancellation | [anonymous-first.test.ts](../../tests/anonymous-first.test.ts) |
| MCP integration | Real HTTP client/transport, headers and sessions per route, exact error classifiers, per-call evidence, shared initialization, session recovery, cancellation and shutdown | [exa-mcp-client.test.ts](../../tests/exa-mcp-client.test.ts) |
| OAuth integration | Refresh outcomes, expiry and issuer preservation, credential alternatives, 401 budget, revision retirement and three-route shutdown | [oauth-state.test.ts](../../tests/oauth-state.test.ts), [oauth-routing.test.ts](../../tests/oauth-routing.test.ts) |
| Explicit login | Discovery/register/PKCE/state/exchange, callback validation, staged read-only initialization, preservation of committed state, deadline/cancellation and connection retirement | [oauth-login.test.ts](../../tests/oauth-login.test.ts) |
| Management | Actual loader; TUI/RPC/JSON/print boundaries; transient URL removal, intercepted best-effort browser launch, commit-before-notice, local status, safe errors and saved-session secrecy; completion candidates, whitespace/case, descriptions, actual Pi insertion and absence of side effects | [management-command.test.ts](../../tests/management-command.test.ts), [strategy-command.test.ts](../../tests/strategy-command.test.ts) |
| Secret boundary | Real Pi loading, rendering, notifications, logs and persisted conversation records, including OAuth/storage failures | [oauth-boundary.test.ts](../../tests/oauth-boundary.test.ts), [exa-mcp-client.test.ts](../../tests/exa-mcp-client.test.ts), [state-loader.test.ts](../../tests/state-loader.test.ts) |

### Routing Boundaries

Exercise both tools and strategies with no credentials, each credential alone, both credentials, expired/refreshable OAuth and login-required state. Anonymous success must not read OAuth. Settings replacement, including from another process, must affect the next call without changing an in-flight strategy snapshot.

Cover zero/past/2,000 ms/over-limit/no-header probe timing, header precedence and epoch units, the final 429 deadline, concurrent cooldown maxima and success reset. Error classifiers need exact authenticated 402/429 prefixes and near misses: wrong route/tool, leading text, later block, missing `isError`, natural-language limits and raw HTTP 402. Compose session 404, anonymous probe, OAuth 401 and fallback so no budget resets or third route can appear. Final failures retain only the final route's code and retry time.

### Cancellation and Secret Boundaries

Test cancellation during discovery, exchange, validation, callback wait, refresh, lock acquisition, shared initialization, anonymous delay and tool HTTP. Surviving initialization waiters remain usable; abort never authorizes fallback. Shutdown must close in-flight resources and all routes under one termination grace, including repeated close calls.

Use secret sentinels in headers, credential-bearing URLs, nested SDK errors/causes, formatter suffixes, tokens/client secrets, challenges, authorization URLs/codes/state/verifiers and storage failures. Inspect exceptions, details, display, notifications, logs and actual SessionManager records rather than string conversion alone. The transient login screen is the only authorization-URL display.

Login tests include SSE initialization before EOF, cancellation while that response is pending, closed streams and old-state preservation. Distinguish callback acceptance from committed-login success. Inject the five-minute deadline without replacing real HTTP timing.

## Lock and State Cases

The [state](design/oauth-state.md) and [lock](design/oauth-state-locking.md) contracts define required behavior. L1–L5 identify verification groups, not implementation tasks.

| Group | Required evidence | Test source |
| --- | --- | --- |
| L1: Loading and contention | Actual Pi loader loads SQLite lazily. Two processes racing first use of an absent DB admit only one protected operation; repeat with the retained DB. Verify numeric BUSY classification, event-loop progress during polling, acquisition after release, separate same-process connections and canonical aliases without a local mutex. | [state-store.test.ts](../../tests/state-store.test.ts), [state-loader.test.ts](../../tests/state-loader.test.ts) |
| L2: Lifetime and recovery | Exclusion spans awaited work and JSON rename. Ordinary cleanup and forced owner exit allow later acquisition on the same DB, without deletion. Use synchronization and a generous recovery deadline rather than instantaneous OS-cleanup assertions. | [state-store.test.ts](../../tests/state-store.test.ts) and its state workers |
| L3: Bounded waits and cleanup | Abort/timeout during setup or polling cannot enter later; abort immediately after synchronous acquisition cleans up. Fake time covers the setup-inclusive budget. Inject unavailable-module, non-BUSY, rollback and close failures; require safe errors and best-effort cleanup without fallback or stale-file deletion. Do not claim synchronous I/O is interruptible. | [oauth-lock.test.ts](../../tests/oauth-lock.test.ts) |
| L4: Transaction integration | Two real processes share one rotating-token refresh for proactive expiry and SDK 401 recovery, then reuse committed state. Earlier login cannot replace another process's login, refresh or logout; browser wait holds no lock. OAuth ownership does not block settings or a separate directory. | [oauth-process.test.ts](../../tests/oauth-process.test.ts), [login-process.test.ts](../../tests/login-process.test.ts), [state-store.test.ts](../../tests/state-store.test.ts) |
| L5: Commit failures | Readers see complete settings/OAuth records across replacement. Failed write/rename leaves committed memory unchanged. Remote rotation followed by persistence failure cannot resend the old token or select alternate credentials. Cleanup releases the lock and cannot undo another writer or delete its temporary file. | [state-store.test.ts](../../tests/state-store.test.ts), [oauth-state.test.ts](../../tests/oauth-state.test.ts), [oauth-routing.test.ts](../../tests/oauth-routing.test.ts), [oauth-login.test.ts](../../tests/oauth-login.test.ts) |
| Settings independence | Reject corrupt, unknown-version and unreadable state without overwriting it. Controlled same-process and child-process writers use successful replacement order, regardless of command/notification order, with no revision, merge or storage-conflict result. Settings never load SQLite or create its DB, including when SQLite is disabled or OAuth ownership is held. Verify directory/file protection. | [state-store.test.ts](../../tests/state-store.test.ts), [state-loader.test.ts](../../tests/state-loader.test.ts) |

Local fixtures establish transaction composition and rotating-token behavior, not Hosted refresh-token issuance.

## Runtime and Package Checks

The [CI workflow](../../.github/workflows/ci.yml) runs check and test on Linux x64, macOS arm64 and Windows x64 using the declared development runtime. Tests assert effective Node version, OS and CPU. Require successful checks on the final PR revision; local Linux results do not substitute for another platform.

The supported Node minimum is 24.15.0. Current CI does not separately test that minimum. Historical minimum-runtime results belong to release records.

For package changes, run `vp pm pack -- --dry-run --json` and verify loading through Pi's real extension loader. The artifact contains only LICENSE, README, package.json and required TypeScript source: no tests, fixtures, local state, secrets, server runtime dependencies or generated distribution. Use `vp run changeset status` to inspect release intent without generating versions.

Local, CI and package success do not establish Hosted compatibility or authorize publication. Follow the [release procedure](releases.md) for those separate steps.
