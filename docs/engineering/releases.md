# npm Release Procedure

## Current Release State

`@hudrazine/pi-exa-web@0.1.0` is published and verified under `latest`; `preview` remains on `0.0.1`. Git tag and GitHub Release `v0.1.0` identify the publication commit.

Changesets now owns subsequent package versions and `CHANGELOG.md` updates. New changelog entries include links to the originating GitHub pull request, commit, and author. A push to `main` runs `.github/workflows/publish.yml`, which either creates or updates the release pull request, publishes an approved release, or exits without release work. The first Changesets-managed release remains to be verified under the active [Changesets Release Automation Plan](plans/changesets-release-automation.md).

The no-release path is verified on `main`: Vite+ supplied pnpm `11.22.0`, Changesets selected no release work, and the privileged jobs remained skipped.

## Preconditions

- Work from a clean branch based on current `main`.
- Use the Node.js and pnpm versions declared in `package.json`.
- Do not edit `package.json` or `CHANGELOG.md` manually for a routine release; Changesets updates them in the release pull request.
- Obtain explicit authorization before approving `npm-production` or making another external release change.
- Keep `EXA_API_KEY` unset for registry-package smoke tests and do not intentionally consume the anonymous quota to force a 429.
- Do not add a build or generated distribution artifact. Pi loads the published TypeScript source through jiti.
- GitHub Actions must be allowed to create pull requests before release-PR automation can operate. This repository setting is not managed by the workflow.

## Record A Release Intent

Follow the repository policy in [`.changeset/README.md`](../../.changeset/README.md).

1. For a user-visible package change, run:

   ```sh
   vp run changeset
   ```

2. Select the SemVer bump and write a concise user-facing summary.
3. Commit the generated `.changeset/*.md` file with the implementation pull request.
4. A changeset is not required for documentation, tests, CI configuration, or an internal refactor that does not change published behavior. Use `vp run changeset --empty` when an explicit no-release record is useful.

## Review And Publish A Release

1. After changesets reach `main`, the `select-mode` job chooses the release mode.
2. When versioning is required, the `version` job uses `changesets/action/version` to create or update `chore(release): version package`. This job can write repository contents and pull requests but has no OIDC permission.
3. Review the release pull request's package version, consumed changesets, and GitHub-linked `CHANGELOG.md` entries, then run or approve its required CI checks and merge it.
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
2. Confirm that the registry artifact contains only `README.md`, `LICENSE`, `package.json`, and the four `src/*.ts` files.
3. Confirm that the Git tag, GitHub Release, npm version, and `CHANGELOG.md` entry use the same version and release notes.
4. Install the exact registry version in a clean Pi package directory.
5. With `EXA_API_KEY` unset, make one bounded anonymous `web_search` call and one bounded anonymous `web_fetch` call.

Do not treat a release as verified until the registry-installed package passes the smoke tests.

## Failure Handling

- Do not fall back to an npm token when OIDC authentication fails. Check the exact repository, `publish.yml`, `npm-production`, `id-token: write`, and GitHub-hosted runner configuration, then rerun the failed workflow.
- Do not approve `npm-production` when the verification job or package-file inspection is incomplete.
- If release-PR creation is denied, verify that GitHub Actions may create pull requests; do not broaden workflow permissions.
- If a local version simulation must generate GitHub-linked changelog entries, provide an appropriately scoped `GITHUB_TOKEN` locally and never commit it. The release workflow uses the GitHub-provided token and does not need a separate secret.
- If Changesets fails with `spawn pnpm ENOENT`, confirm that the `select-mode`, `version`, and `publish` jobs expose the directory returned by `vp env which pnpm` immediately after `setup-vp`. Keep using Vite+'s managed pnpm rather than adding a second package-manager setup path.
- A failed publish that did not create the npm version may be retried after correcting the workflow or external configuration.
- Published npm versions are immutable. Correct a bad artifact with a new patch version rather than trying to reuse a version.
