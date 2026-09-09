# Quality and Development

Changes must preserve the [product requirements](product.md), [tool contract](design/web-tools.md), and [authentication policy](design/anonymous-first.md). Normal checks use local transports and deterministic timing; they must not depend on Hosted Exa availability or consume its quota. Unimplemented OAuth verification belongs to the [OAuth implementation plan](plans/oauth-routing.md#implementation-verification).

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
| SDK integration | Real MCP client/transport against a local server: exact body replay, headers, call-local routes under concurrency, one shared initialization, cancellation, failure recovery, in-flight closure, bounded unresponsive termination, repeated shutdown | [`tests/exa-mcp-client.test.ts`](../../tests/exa-mcp-client.test.ts) |

Test expectations must follow the relevant contract, not private filenames or class structure. Successful text preservation and error secrecy are distinct obligations; terminal sanitization alone does not satisfy the latter. The current [error-handling gap](design/web-tools.md#errors-and-secret-handling) remains visible until implementation and verification address it.

The current [CI workflow](../../.github/workflows/ci.yml) runs checks and tests on Linux. The planned SQLite feature adds OS/runtime obligations in its implementation plan; those are not current verified capabilities.

## Hosted and Release Verification

Use bounded manual smoke tests for deployment compatibility. A normal anonymous smoke makes one search and one fetch with `EXA_API_KEY` unset; it does not intentionally exhaust quota to exercise fallback. Live OAuth verification has its own [release condition](plans/oauth-routing.md#hosted-oauth-release-smoke).

The [release procedure](releases.md) owns registry-artifact and post-publication checks. [Initial release evidence](records/initial-release.md) records completed loader, local-path, registry, and OIDC verification. These are retained results, not claims that external registry tags or repository settings were rechecked during this documentation review. The [Changesets plan](plans/changesets-release-automation.md) identifies the remaining automation verification.
