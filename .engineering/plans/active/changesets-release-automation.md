---
type: plan
status: active
---

# Changesets Release Automation Plan

## Goal

After `@hudrazine/pi-exa-web@0.1.0` is published and verified, use Changesets to maintain versions and `CHANGELOG.md`, create a reviewable release pull request, and automate trusted npm publication, Git tags, and GitHub Releases behind the existing `npm-production` approval.

## Current State

- The initial release remains in progress under the [Initial Release Plan](initial-release.md).
- `.github/workflows/publish.yml` is intentionally limited to the formal `0.1.0` release.
- Its `EXPECTED_VERSION: 0.1.0` check is a one-time safety guard, not a value to update for later releases.
- The package has no Changesets configuration or dependency and no `CHANGELOG.md`.
- `bumpp` is present as an unused development dependency.
- npm Trusted Publisher and GitHub Environment setup cannot be completed until the scoped preview package exists.

## Proposed Changes

Adopt a stable, mutually compatible Changesets CLI and GitHub Action after `0.1.0`. Preserve the `publish.yml` filename and `npm-production` environment so the npm trust binding remains stable, but replace the one-time workflow behavior and remove `EXPECTED_VERSION` and its fixed-version check. Changesets and the release pull request will own subsequent version updates; maintainers will not edit the workflow for each release. Keep release-PR permissions separate from publish permissions, and require the existing environment approval only for the OIDC publish job.

## Tasks

1. [ ] Recheck the stable Changesets CLI, Changesets Action, pnpm, and npm Trusted Publisher compatibility before selecting versions.
2. [ ] Add Changesets configuration and package scripts for changeset creation, versioning, and publishing; remove `bumpp` if it remains unused.
3. [ ] Seed `CHANGELOG.md` with the verified `0.1.0` release notes so public history starts with the initial formal release.
4. [ ] Define when a pull request requires a changeset and how maintainers record an intentional no-release change.
5. [ ] Add a least-privilege release-PR job that collects merged changesets and updates the version and changelog without OIDC permission.
6. [ ] Replace the one-time `0.1.0` publish behavior in `publish.yml`, remove `EXPECTED_VERSION` and its fixed-version check, and add a generic publish job that runs checks and package inspection, waits for `npm-production` approval, publishes through OIDC, and creates the Git tag and GitHub Release.
7. [ ] Test the version and changelog flow without contacting npm, then verify the first automated release with bounded registry and Pi smoke tests.
8. [ ] Update the release procedure, archive this plan, and retain only current release instructions.

## Completion Criteria

- Releasable pull requests carry a reviewable version intent and user-facing summary.
- The release pull request owns package version and changelog updates without manual duplication.
- Only the approved publish job has `id-token: write`; no long-lived npm publish token exists.
- A successful release produces matching npm metadata, Git tag, GitHub Release, and `CHANGELOG.md` content.
- Routine releases require only changeset authoring, release-PR review and merge, and one `npm-production` approval; they do not require editing `publish.yml` or an expected-version value.
