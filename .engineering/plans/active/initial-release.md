---
type: plan
status: active
---

# Initial Release Plan

## Goal

Publish and verify `@hudrazine/pi-exa-web@0.0.1` under the `preview` dist-tag, deprecate the unscoped preview with a migration message, then publish `0.1.0` through npm Trusted Publisher after one GitHub Environment approval.

## Current State

- The accepted [Exa Web Extension design](../../design/exa-web-extension.md) is implemented and locally verified.
- The [initial implementation plan](../archive/initial-implementation.md) is complete and archived.
- The public README documents installation, tool inputs, authentication behavior, limits, troubleshooting, and development.
- `package.json` declares the permanent npm name `@hudrazine/pi-exa-web` and bootstrap preview version `0.0.1`.
- The repository contains a dedicated `0.1.0` publish workflow that separates verification from the approval-gated OIDC publish job.
- The [npm release procedure](../../development/releases.md) owns the exact local and external steps.
- Changesets is intentionally deferred to the separate [release automation plan](changesets-release-automation.md) after `0.1.0`.
- The final `0.0.1` repository files pass format, lint, typecheck, all 36 tests, and dry-run package inspection.
- `pi-exa-web@0.0.1` is published and verified from the npm registry. The registry tarball matches the intended seven-file set, and both bounded Pi tool calls succeeded through the anonymous route.
- `@hudrazine/pi-exa-web@0.0.1` is published and verified from the npm registry. Its seven-file tarball has the expected metadata, and its LICENSE and four source files match the verified unscoped artifact byte for byte, so the accepted name-only migration reuses the completed Pi smoke-test evidence.
- The scoped `preview` and temporary bootstrap `latest` tags both resolve to `0.0.1`. The formal `0.1.0` release will move `latest`.
- The unscoped `pi-exa-web@0.0.1` remains as migration evidence and is deprecated with `Moved to @hudrazine/pi-exa-web`.

## Proposed Changes

Publish the verified contents as `@hudrazine/pi-exa-web@0.0.1`, inspect the immutable scoped artifact, and deprecate the unscoped package with the supported replacement. Then publish `0.1.0` from `main` through the `publish.yml` workflow, with automated release gates followed by one required `npm-production` approval. Do not use a long-lived npm publish token.

## Tasks

1. [x] Set `package.json` to `0.0.1` and add the repository-side release procedure and least-privilege `0.1.0` publish workflow.
2. [x] Run `vp run check` and `vp run test` against the final preview files.
3. [x] Run `vp pm pack -- --dry-run --json` and confirm that it contains only README, license, package metadata, and the four TypeScript source files.
4. [x] After explicit authorization, publish `0.0.1` interactively with 2FA and the `preview` dist-tag.
5. [x] Install `pi-exa-web@0.0.1` from npm, inspect the registry artifact, and complete one bounded anonymous call with each tool.
6. [x] Rename the npm package to `@hudrazine/pi-exa-web`, update current documentation, and repeat the repository checks and dry-run package inspection.
7. [x] Publish `@hudrazine/pi-exa-web@0.0.1` under `preview`, inspect the scoped registry artifact, and confirm that its source files match the verified unscoped artifact without repeating the Pi smoke test.
8. [x] Deprecate the unscoped `pi-exa-web` package with a message directing users to `@hudrazine/pi-exa-web`.
9. [ ] Create the `npm-production` GitHub Environment with one required reviewer and a `main` deployment restriction.
10. [ ] Configure npm Trusted Publisher for `@hudrazine/pi-exa-web`, `hudrazine/pi-exa-web`, `publish.yml`, `npm-production`, and `npm publish`; do not configure a publish token.
11. [ ] Set `package.json` to `0.1.0`, repeat the local release gates, and merge the release files to `main`.
12. [ ] Dispatch `publish.yml` from `main`, inspect the successful verification evidence, approve `npm-production`, and confirm OIDC publication under `latest`.
13. [ ] Install `@hudrazine/pi-exa-web@0.1.0` from npm and complete one bounded anonymous call with each tool.
14. [ ] Create the `v0.1.0` Git tag and GitHub Release, require 2FA while disallowing traditional npm tokens, and reconcile the published result with the README and active design.
15. [ ] Move this plan to `plans/archive/` with `status: archived` and update the engineering index. Leave the Changesets plan active for the next release.

## Completion Criteria

- npm serves scoped `0.0.1` under `preview` and scoped `0.1.0` under `latest`, with the intended metadata and no generated distribution artifact.
- The unscoped package is deprecated with a message that identifies `@hudrazine/pi-exa-web` as its replacement.
- `0.1.0` is published by `publish.yml` through OIDC only after the verification job and one `npm-production` approval.
- `pi install npm:@hudrazine/pi-exa-web@0.1.0` installs a package that registers only `web_search` and `web_fetch`.
- Both tools complete one bounded anonymous call against Exa Hosted MCP from the registry-installed package.
- Checks, tests, package inspection, registry installation, and the active documentation all agree with the released package.
- The initial release plan is archived after verification; Changesets automation remains separate follow-up work.
