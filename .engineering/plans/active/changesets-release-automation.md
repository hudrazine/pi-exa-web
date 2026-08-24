---
type: plan
status: active
---

# Changesets Release Automation Plan

## Goal

After `@hudrazine/pi-exa-web@0.1.0` is published and verified, use Changesets to maintain versions and `CHANGELOG.md`, create a reviewable release pull request, and automate trusted npm publication, Git tags, and GitHub Releases behind the existing `npm-production` approval.

## Current State

- The initial release is complete and retained in the archived [Initial Release Plan](../archive/initial-release.md).
- `@hudrazine/pi-exa-web@0.1.0`, Git tag `v0.1.0`, and its GitHub Release are published and verified.
- The `npm-production` Environment and npm Trusted Publisher are configured and have completed one approval-gated OIDC publication without a token or GitHub secret.
- `@changesets/cli@3.0.1` is locked as a development dependency, and `bumpp` has been removed.
- `.changeset/config.json`, package scripts, the pull-request changeset policy, and a `CHANGELOG.md` seeded from `0.1.0` are implemented.
- `.github/workflows/publish.yml` uses the individual `changesets/action@2.1.1` actions for mode selection, release-PR versioning, and publishing.
- The release-PR job has repository and pull-request write access but no OIDC permission. Only the approval-gated `npm-production` publish job has `id-token: write`.
- Local checks, all 36 tests, a frozen install, seven-file package inspection, workflow parsing and permission assertions, and an isolated `0.1.0` to `0.1.1` Changesets version simulation pass.
- No npm publication or GitHub repository setting was changed. The first live Changesets-managed release and its external verification remain outstanding.

## Proposed Changes

Verify the repository-side Changesets implementation with the first live automated release. Preserve the `publish.yml` filename and `npm-production` environment so the npm trust binding remains stable. Changesets and the release pull request own subsequent version and changelog updates; maintainers do not edit the workflow for each release. Keep release-PR permissions separate from publish permissions, and require the existing environment approval only for the OIDC publish job.

## Tasks

1. [x] Recheck the stable Changesets CLI, Changesets Action, pnpm, and npm Trusted Publisher compatibility before selecting versions.
2. [x] Add Changesets configuration and package scripts for changeset creation, versioning, and publishing; remove `bumpp`.
3. [x] Seed `CHANGELOG.md` with the verified `0.1.0` release notes so public history starts with the initial formal release.
4. [x] Define when a pull request requires a changeset and how maintainers record an intentional no-release change.
5. [x] Add a least-privilege release-PR job that collects merged changesets and updates the version and changelog without OIDC permission.
6. [x] Replace the one-time `0.1.0` publish behavior in `publish.yml`, remove `EXPECTED_VERSION` and its fixed-version check, and add a generic publish job that runs checks and package inspection, waits for `npm-production` approval, publishes through OIDC, and creates the Git tag and GitHub Release.
7. [x] Test the version and changelog flow locally without contacting npm.
8. [x] Update the current release procedure for Changesets-managed releases.
9. [ ] Verify the first automated release with matching npm metadata, provenance, Git tag, GitHub Release, changelog, and bounded registry and Pi smoke tests.
10. [ ] Archive this plan after the first automated release is verified.

## Completion Criteria

- Releasable pull requests carry a reviewable version intent and user-facing summary.
- The release pull request owns package version and changelog updates without manual duplication.
- Only the approved publish job has `id-token: write`; no long-lived npm publish token exists.
- A successful release produces matching npm metadata, Git tag, GitHub Release, and `CHANGELOG.md` content.
- Routine releases require only changeset authoring, release-PR review and merge, and one `npm-production` approval; they do not require editing `publish.yml` or an expected-version value.
