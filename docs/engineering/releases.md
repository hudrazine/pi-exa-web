# Release Procedure

Changesets owns package versioning and `CHANGELOG.md`. A push to `main` runs [publish.yml](../../.github/workflows/publish.yml), which creates a release PR, publishes an approved version, or exits without release work. Pi loads the TypeScript source directly; there is no build or generated distribution.

This document defines the default procedure. Completed release evidence and any release-specific exceptions belong in [release records](README.md#historical-evidence), not in the operational steps.

## Release Intent and Preconditions

Follow the [Changesets policy](../../.changeset/README.md) for user-visible changes. Use `vp run changeset` and commit the generated entry with the implementation PR. Do not manually edit the package version or changelog for routine releases.

Before releasing:

- Work from a clean branch based on current `main`, using the runtime and package manager declared in [package.json](../../package.json).
- Complete the [local, CI and package checks](quality.md#runtime-and-package-checks) on the intended revision.
- Confirm GitHub Actions may create PRs; this repository setting is not managed by the workflow.
- Obtain explicit authorization before approving `npm-production` or making another external release change.
- Use separate, empty Pi agent directories for Hosted OAuth and registry-installed anonymous smoke, with `EXA_API_KEY` unset. Do not consume quota deliberately to force a rejection.

## Hosted OAuth Smoke

This pre-publication check requires operator account access and explicit interactive login. Set `PI_CODING_AGENT_DIR` to an isolated local directory and install/run the intended package there. Use the actual `/exa` command and Pi tools. Scripted external checks also require `PI_EXA_WEB_LIVE_TEST=1`.

1. Run `/exa login` and confirm callback completion and authenticated initialization. Record access-token and refresh-token presence, never values.
2. Select `authenticated-first` and run one search. Confirm successful text and `details.auth: oauth`.
3. Restart Pi with the same directory. Exercise real refresh using the issued refresh token, then run one fetch with the OAuth route. A documented test-only local expiry override may trigger refresh without waiting for natural expiry. If no refresh token is issued, review the refresh-support claim before release; do not mark refresh verified.
4. Check local status/logout and clean up credentials. Local state transitions and API-key preservation are covered by regression tests and need no extra Hosted requests.

Allow at most four OAuth tool sends including retries; normally two suffice. Stop on unexpected behavior. Do not deliberately provoke Hosted 401/429, exhaust credits or wait for natural expiry. Anonymous smoke belongs to the registry check below and is not duplicated here.

Record date, SDK version, login outcome, restart/refresh result and effective routes. Never record tokens, codes, authorization URLs, API keys, queries, fetched URLs, result text or network dumps. Missing account access leaves the check incomplete.

## Version and Publish

1. Changesets on `main` select version mode. The version job creates or updates `chore(release): version package`; it can write contents and PRs but has no OIDC permission.
2. Review the generated version, consumed changesets, and changelog links to originating PRs, commits and authors. Require successful CI and the Hosted OAuth check before merging. The release PR uses `GITHUB_TOKEN`; if GitHub requests workflow approval, a maintainer approves those CI runs.
3. Merging the release PR selects publish mode. The read-only verify job runs `vp run check`, `vp run test` and `vp pm pack -- --dry-run --json` before deployment approval.
4. Inspect the verification results and file list. With explicit authorization, approve the waiting `npm-production` deployment.
5. The publish job alone has `id-token: write`. It runs `vp run release` through Changesets and pnpm using npm Trusted Publisher. `prepublishOnly` repeats check and test. No npm token is used.
6. The publish action pushes `v<version>` and creates the corresponding GitHub Release from the changelog.

## Trusted Publisher Configuration

The external binding is exact and case-sensitive:

| Setting              | Value            |
| -------------------- | ---------------- |
| Organization or user | `hudrazine`      |
| Repository           | `pi-exa-web`     |
| Workflow             | `publish.yml`    |
| Environment          | `npm-production` |
| Allowed action       | `npm publish`    |

`npm-production` requires one reviewer and accepts deployments only from `main`. A sole maintainer must be able to self-review unless another eligible reviewer is added. Do not add an npm token to GitHub.

## Registry Verification

After publication:

1. Confirm npm `latest` resolves to the reviewed version and that the artifact carries provenance.
2. Compare the registry artifact with the reviewed dry-run file list and publication commit. It must contain LICENSE, README, package.json and required TypeScript source only.
3. Confirm the npm version, Git tag, GitHub Release and changelog agree on version and release notes.
4. In a dedicated shell, create an empty agent directory and unset the API key before installing or starting Pi:

   ```sh
   export PI_CODING_AGENT_DIR="$(mktemp -d)"
   unset EXA_API_KEY
   pi install npm:@hudrazine/pi-exa-web@<reviewed-version>
   ```

   Replace the version placeholder. Retain this environment for the smoke. Do not copy normal agent settings, saved OAuth state or package settings; configure only model access needed for the check.

5. Start Pi from a clean working directory without project extensions or package settings. Confirm the exact registry package supplies the tools, rather than a local checkout or second installation.
6. Make one bounded `web_search` call and one bounded `web_fetch` call. Both must succeed with `details.auth: anonymous` and no fallback. Do not log in, change strategy, reuse the OAuth-smoke directory or issue extra calls to provoke a rate limit. Stop on unexpected routes or failures and leave verification incomplete.

Exit Pi before removing only the isolated smoke directory. Never delete or replace a live OAuth coordination DB or journal. The normal agent directory is outside this procedure.

Registry-installed compatibility is verified only by a successful registry smoke. A maintainer decision to waive a check must be recorded as a waiver, not a successful execution.

## Failure Handling

| Failure | Action |
| --- | --- |
| OIDC authentication | Check the exact trust binding, `id-token: write` and GitHub-hosted runner configuration, then rerun. Do not substitute an npm token. |
| Verification or file inspection incomplete | Do not approve deployment. |
| Release-PR creation denied | Check the Actions PR-creation setting; do not broaden workflow permissions. |
| Local changelog simulation needs GitHub links | Supply an appropriately scoped `GITHUB_TOKEN` locally; never commit it. The workflow uses its provided token. |
| Changesets reports `spawn pnpm ENOENT` | Check setup-vp completion and the managed pnpm shim on subsequent steps' PATH. Its version must match package.json. Keep Vite+'s managed pnpm rather than adding another setup path. |
| Publish fails before creating the npm version | Correct the cause and retry the workflow. |
| Published artifact is wrong | Publish a corrected patch version. npm versions are immutable. |
