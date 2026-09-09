# Quality and Development

Changes must preserve the [product requirements](product.md), [tool contract](design/web-tools.md), and [authentication policy](design/anonymous-first.md). Normal checks use local transports and deterministic timing; they must not depend on Hosted Exa availability or consume its quota. The [OAuth verification specification](plans/oauth-verification.md) maps PR1 connection checks and PR2 storage checks; OAuth lifecycle verification remains pending.

## Local Workflow

Use Vite+ and the runtime/package-manager versions in [`package.json`](../../package.json):

```sh
vp install
vp run check
vp run test
```

`check` covers formatting, linting, and types. Pi loads TypeScript source directly, so there is no build step. For package changes, inspect `vp pm pack -- --dry-run --json` without creating a tarball and verify loading through Pi's real extension loader. Publication must exclude tests, fixtures, local state, and secrets.

## Verification Responsibilities

| Area | Required evidence | Existing test source |
| --- | --- | --- |
| Pi contract | Names, schemas, bounds, argument mapping, optional omission, successful content/details, thrown errors | [`tests/index.test.ts`](../../tests/index.test.ts) |
| Display | Pending, success, error, cancellation, collapsed/expanded output, requested-count labels; real Pi `ToolExecutionComponent` coverage without unstable style snapshots | [`tests/index.test.ts`](../../tests/index.test.ts) |
| Authentication policy | Short/long/no-header 429, header parsing, block expiry, missing key, terminal authenticated failures, abort-aware delay, credential isolation, no retry cycles | [`tests/anonymous-first.test.ts`](../../tests/anonymous-first.test.ts) |
| SDK integration | Real MCP client/transport against a local server: intent replay, route-specific headers/sessions, concurrent failure evidence, per-route initialization sharing, HTTP cancellation, session-only recovery, in-flight closure, one shared termination grace, repeated shutdown | [`tests/exa-mcp-client.test.ts`](../../tests/exa-mcp-client.test.ts) |

Test expectations must follow the relevant contract, not private filenames or class structure. Successful text preservation and error secrecy are distinct obligations. The [tool contract](design/web-tools.md#errors-and-secret-handling) owns the safe-output boundary. `tests/exa-mcp-client.test.ts` also loads the source through Pi's real loader, checks secret-free error objects and rendering, and writes error results with Pi's SessionManager to verify persisted conversation records.

PR2 adds `tests/oauth-lock.test.ts` and `tests/state-store.test.ts` for L1–L3, revisions, complete replacement, cleanup, same/child-process settings ordering and directory isolation. `tests/state-loader.test.ts` checks real Pi/jiti loading of SQLite, storage-error rendering and SessionManager records, and the effective runtime.

The [CI workflow](../../.github/workflows/ci.yml) defines development-runtime jobs on Linux x64, macOS arm64 and Windows x64, plus Node 24.15.0 on Linux. Every job runs the full check/test suite and asserts the effective test-process runtime. Local Linux results do not establish macOS/Windows success; all four CI results remain required before PR2 completion.

The minimum-runtime job selects `vp env use 24.15.0` and invokes `vp check` / `vp test` directly. `vp run` scripts resolve pnpm's local Node shim pinned by `devEngines.runtime`, which otherwise runs 24.19.0 even after a session override. Development jobs retain `vp run check` / `vp run test`; the test-process assertion guards both paths.

## Hosted and Release Verification

Use bounded manual smoke tests for deployment compatibility. A normal anonymous smoke makes one search and one fetch with `EXA_API_KEY` unset; it does not intentionally exhaust quota to exercise fallback. Live OAuth verification has its own [release condition](plans/oauth-verification.md#hosted-oauth-release-smoke).

The [release procedure](releases.md) owns registry-artifact and post-publication checks. [Initial release evidence](records/initial-release.md) records completed loader, local-path, registry, and OIDC verification. Historical results do not establish current registry tags or repository settings. The [Changesets plan](plans/changesets-release-automation.md) identifies the remaining automation verification.
