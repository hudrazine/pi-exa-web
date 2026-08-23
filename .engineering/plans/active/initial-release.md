---
type: plan
status: active
---

# Initial Release Plan

## Goal

Publish `pi-exa-web@0.1.0` to npm and verify that Pi can install and run the registry package without a build step.

## Current State

- The accepted [Exa Web Extension design](../../design/exa-web-extension.md) is implemented and locally verified.
- The [initial implementation plan](../archive/initial-implementation.md) is complete and archived.
- The public README documents installation, tool inputs, authentication behavior, limits, troubleshooting, and development.
- `package.json` still declares version `0.0.0`.
- The latest recorded package checks, tests, real-loader verification, dry-run package inspection, and local-path smoke test succeeded before the release version was set.
- npm publication and registry installation have not been performed.

## Proposed Changes

Set the initial public version, repeat every release gate against the final files, publish only with explicit user authorization, and verify the installed registry package with bounded live calls.

## Tasks

1. [ ] Set `package.json` to version `0.1.0`, then confirm the name, description, repository, license, public access, runtime dependencies, peer dependencies, Node.js engine, published files, and `pi.extensions` entry.
2. [ ] Run `vp run check` and `vp run test` after the version and release documentation are final.
3. [ ] Run `pnpm pack --dry-run --json` without creating a tarball. Confirm that the publish list contains only the intended README, license, package metadata, and TypeScript source files, with no credentials or local artifacts.
4. [ ] Publish `pi-exa-web@0.1.0` to npm only after the user gives explicit authorization for that external change.
5. [ ] Install the published version with `pi install npm:pi-exa-web@0.1.0` in a clean registry-install path.
6. [ ] With `EXA_API_KEY` unset, make one bounded `web_search` call and one bounded `web_fetch` call and confirm that both report the `anonymous` route. Do not intentionally exhaust anonymous quota to test fallback.
7. [ ] Reconcile the published behavior and package contents with the README and active design, then move this plan to `plans/archive/` with `status: archived` and update the engineering index.

## Completion Criteria

- npm serves `pi-exa-web@0.1.0` with the intended metadata and file set and no generated distribution artifact.
- `pi install npm:pi-exa-web@0.1.0` installs a package that registers only `web_search` and `web_fetch`.
- Both tools complete one bounded anonymous call against Exa Hosted MCP from the registry-installed package.
- Checks, tests, package inspection, registry installation, and the active documentation all agree with the released package.
- No release plan remains active after the verified release is archived.
