---
type: plan
status: active
---

# Initial Release Plan

## Goal

Publish and verify `pi-exa-web@0.0.1` under the `preview` dist-tag, then publish `0.1.0` through npm Trusted Publisher after one GitHub Environment approval.

## Current State

- The accepted [Exa Web Extension design](../../design/exa-web-extension.md) is implemented and locally verified.
- The [initial implementation plan](../archive/initial-implementation.md) is complete and archived.
- The public README documents installation, tool inputs, authentication behavior, limits, troubleshooting, and development.
- `package.json` declares the bootstrap preview version `0.0.1`.
- The repository contains a dedicated `0.1.0` publish workflow that separates verification from the approval-gated OIDC publish job.
- The [npm release procedure](../../development/releases.md) owns the exact local and external steps.
- Changesets is intentionally deferred to the separate [release automation plan](changesets-release-automation.md) after `0.1.0`.
- The final `0.0.1` repository files pass format, lint, typecheck, all 36 tests, and dry-run package inspection.
- npm publication and registry installation have not been performed.

## Proposed Changes

Use a manually authorized `0.0.1` preview to validate the immutable registry artifact before configuring Trusted Publisher. Then publish `0.1.0` from `main` through the `publish.yml` workflow, with automated release gates followed by one required `npm-production` approval. Do not use a long-lived npm publish token.

## Tasks

1. [x] Set `package.json` to `0.0.1` and add the repository-side release procedure and least-privilege `0.1.0` publish workflow.
2. [x] Run `vp run check` and `vp run test` against the final preview files.
3. [x] Run `vp pm pack -- --dry-run --json` and confirm that it contains only README, license, package metadata, and the four TypeScript source files.
4. [ ] After explicit authorization, publish `0.0.1` interactively with 2FA and the `preview` dist-tag.
5. [ ] Install `pi-exa-web@0.0.1` from npm, inspect the registry artifact, and complete one bounded anonymous call with each tool.
6. [ ] Create the `npm-production` GitHub Environment with one required reviewer and a `main` deployment restriction.
7. [ ] Configure npm Trusted Publisher for `hudrazine/pi-exa-web`, `publish.yml`, `npm-production`, and `npm publish`; do not configure a publish token.
8. [ ] Set `package.json` to `0.1.0`, repeat the local release gates, and merge the release files to `main`.
9. [ ] Dispatch `publish.yml` from `main`, inspect the successful verification evidence, approve `npm-production`, and confirm OIDC publication under `latest`.
10. [ ] Install `pi-exa-web@0.1.0` from npm and complete one bounded anonymous call with each tool.
11. [ ] Create the `v0.1.0` Git tag and GitHub Release, require 2FA while disallowing traditional npm tokens, and reconcile the published result with the README and active design.
12. [ ] Move this plan to `plans/archive/` with `status: archived` and update the engineering index. Leave the Changesets plan active for the next release.

## Completion Criteria

- npm serves `0.0.1` only under `preview` and serves `0.1.0` under `latest`, with the intended metadata and no generated distribution artifact.
- `0.1.0` is published by `publish.yml` through OIDC only after the verification job and one `npm-production` approval.
- `pi install npm:pi-exa-web@0.1.0` installs a package that registers only `web_search` and `web_fetch`.
- Both tools complete one bounded anonymous call against Exa Hosted MCP from the registry-installed package.
- Checks, tests, package inspection, registry installation, and the active documentation all agree with the released package.
- The initial release plan is archived after verification; Changesets automation remains separate follow-up work.
