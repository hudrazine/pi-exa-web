# npm Release Procedure

## Release Ownership

Changesets owns package versions and `CHANGELOG.md` updates. Changelog entries include originating GitHub pull-request, commit, and author links. A push to `main` runs [`publish.yml`](../../.github/workflows/publish.yml), which creates or updates a release pull request, publishes an approved release, or exits without release work.

The workflow and release-PR generation are implemented. The first complete Changesets-managed publication remains pending in the [release plan](plans/oauth-tickets.md). [Initial release evidence](records/initial-release.md) records the completed `0.1.0` OIDC publication; check registry state during each release rather than relying on that historical result.

## Preconditions

- Work from a clean branch based on current `main`.
- Use the Node.js and pnpm versions declared in `package.json`.
- Do not edit `package.json` or `CHANGELOG.md` manually for a routine release; Changesets updates them in the release pull request.
- Obtain explicit authorization before approving `npm-production` or making another external release change.
- Use a new isolated `PI_CODING_AGENT_DIR` with `EXA_API_KEY` unset for registry-package smoke tests, as described below. Do not intentionally consume the anonymous quota to force a 429.
- Do not add a build or generated distribution artifact. Pi loads the published TypeScript source through jiti.
- GitHub Actions must be allowed to create pull requests before release-PR automation can operate. This repository setting is not managed by the workflow.

## Record a Release Intent

Follow the repository policy in [`.changeset/README.md`](../../.changeset/README.md).

1. For a user-visible package change, run:

   ```sh
   vp run changeset
   ```

2. Select the SemVer bump and write a concise user-facing summary.
3. Commit the generated `.changeset/*.md` file with the implementation pull request.
4. A changeset is not required for documentation, tests, CI configuration, or an internal refactor that does not change published behavior. Use `vp run changeset --empty` when an explicit no-release record is useful.

## Hosted OAuth Smoke

This pre-publication check requires operator account access and explicit login. Run once in an isolated local Pi agent directory selected by `PI_CODING_AGENT_DIR`, with `EXA_API_KEY` unset. Install and run the intended package in that same environment, using the actual `/exa` command and Pi tools. Login requires explicit operator action; scripted external checks also require `PI_EXA_WEB_LIVE_TEST=1`. Use a different empty agent directory for the registry-installed anonymous smoke below.

1. Run `/exa login`; confirm callback completion and authenticated initialization. Record token/refresh-token presence, never values.
2. Select `authenticated-first` and run one search. Verify successful text and `oauth` details.
3. Restart Pi with the same directory. Exercise real refresh using the issued refresh token, then run one fetch. A documented test-only local expiry override may trigger refresh without waiting for natural expiry. If no refresh token is issued, review the refresh-support claim before release; do not mark refresh verified.
4. Check local status/logout and clean up credentials. Verify local state transitions and API-key preservation in the implementation regression suite; they need no extra Hosted requests.

Allow at most four OAuth tool sends including retries; normally two suffice. Stop on unexpected behavior. No deliberate Hosted 401/429, exhausted credits, or natural-expiry wait is required. Use the post-publication anonymous search/fetch smoke below once; do not duplicate it here.

Record date, SDK version, login outcome, restart/refresh result, and effective routes. Do not record tokens, codes, authorization URLs, API keys, queries, fetched URLs, result text, or network dumps. Account access being unavailable leaves this release condition incomplete.

## Review and Publish a Release

1. After changesets reach `main`, the `select-mode` job chooses the release mode.
2. When versioning is required, the `version` job uses `changesets/action/version` to create or update `chore(release): version package`. This job can write repository contents and pull requests but has no OIDC permission.
3. Review the release pull request's package version, consumed changesets, and GitHub-linked `CHANGELOG.md` entries, then run or approve its required CI checks. For `0.2.0`, require the completed local/CI/package gate and the Hosted OAuth smoke below before merging the release PR. The [release plan](plans/oauth-tickets.md) records these gates; passing local tests alone does not establish release readiness.
4. The resulting `main` push selects publish mode. The read-only `verify` job runs `vp run check`, `vp run test`, and `vp pm pack -- --dry-run --json` before any deployment approval.
5. Inspect the completed verification output. After explicit authorization, approve the waiting `npm-production` deployment.
6. Only the approved `publish` job has `id-token: write`. It runs `vp run release`, which uses Changesets and pnpm to publish through npm Trusted Publisher without a token. The package's `prepublishOnly` script repeats check and test during publication.
7. `changesets/action/publish` pushes the single-package `v<version>` tag and creates the matching GitHub Release from the changelog entry.

The release pull request uses the repository `GITHUB_TOKEN`. If GitHub presents an approval banner for workflows created by that token, a maintainer must approve those CI runs before merging the pull request.

## Trusted Publisher Configuration

The external binding must remain exact and case-sensitive:

- organization or user: `hudrazine`
- repository: `pi-exa-web`
- workflow filename: `publish.yml`
- environment: `npm-production`
- allowed action: `npm publish`

`npm-production` requires one reviewer and accepts deployments only from `main`. A sole maintainer must remain able to self-review unless another eligible reviewer is added. Do not add an npm token to GitHub; authentication uses OIDC only.

## Verification

After a successful publication:

1. Confirm that npm `latest` resolves to the release-PR version and that the artifact carries provenance.
2. Compare the registry artifact with the reviewed dry-run file list and publication commit. It must contain the required TypeScript source, README, license, and package metadata, with no tests, fixtures, state, secrets, or generated distribution artifact.
3. Confirm that the Git tag, GitHub Release, npm version, and `CHANGELOG.md` entry use the same version and release notes.
4. In a dedicated shell, set `PI_CODING_AGENT_DIR` to a newly created empty directory and unset `EXA_API_KEY` before installing or starting Pi. For example, in Bash, use `export PI_CODING_AGENT_DIR="$(mktemp -d)"` and `unset EXA_API_KEY`. Keep that environment for all following steps. Do not copy the normal agent directory, saved `exa-web` state or package settings into it; configure only the model access needed for the smoke.
5. In that same environment, install the exact registry version with `pi install npm:@hudrazine/pi-exa-web@<reviewed-version>`, replacing the version placeholder. Start Pi from a clean working directory without project extensions or package settings. Confirm that the registry package provides the tools, rather than a local checkout or a second installation.
6. Make one bounded `web_search` call and one bounded `web_fetch` call. Both must succeed with `details.auth` equal to `anonymous` and no fallback. Do not log in, change strategy, reuse the Hosted OAuth smoke directory, or issue extra calls to provoke a rate limit. Stop on an unexpected route or failure and leave verification incomplete.

Exit Pi before cleaning up the smoke directory, and clean up only that isolated directory. Do not delete or replace a live OAuth coordination DB or journal. The normal Pi agent directory remains outside this procedure.

Do not treat a release as verified until the registry-installed package passes the smoke tests.

## Failure Handling

- Do not fall back to an npm token when OIDC authentication fails. Check the exact repository, `publish.yml`, `npm-production`, `id-token: write`, and GitHub-hosted runner configuration, then rerun the failed workflow.
- Do not approve `npm-production` when the verification job or package-file inspection is incomplete.
- If release-PR creation is denied, verify that GitHub Actions may create pull requests; do not broaden workflow permissions.
- If a local version simulation must generate GitHub-linked changelog entries, provide an appropriately scoped `GITHUB_TOKEN` locally and never commit it. The release workflow uses the GitHub-provided token and does not need a separate secret.
- If Changesets fails with `spawn pnpm ENOENT`, confirm that the `select-mode`, `version`, and `publish` jobs expose the directory returned by `vp env which pnpm` immediately after `setup-vp`. Keep using Vite+'s managed pnpm rather than adding a second package-manager setup path.
- A failed publish that did not create the npm version may be retried after correcting the workflow or external configuration.
- Published npm versions are immutable. Correct a bad artifact with a new patch version rather than trying to reuse a version.
