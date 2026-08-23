---
type: development
status: active
---

# npm Release Procedure

## Preconditions

- Work from a clean `main` branch that matches `origin/main`.
- Use the Node.js and pnpm versions declared in `package.json`.
- Obtain explicit authorization before any npm publication or other external release change.
- Keep `EXA_API_KEY` unset for registry-package smoke tests and do not intentionally consume the anonymous quota to force a 429.
- Do not add a build or generated distribution artifact. Pi loads the published TypeScript source through jiti.

## Bootstrap Preview

The first registry version is `0.0.1`. It exists to claim the npm package, inspect the registry artifact, and test Pi installation before the formal release. It is published under the `preview` dist-tag so it does not become the default install.

1. Confirm that `package.json` declares `0.0.1` and the intended package metadata.
2. Run `vp run check` and `vp run test`.
3. Run `vp pm pack -- --dry-run --json`. Confirm that it lists only `README.md`, `LICENSE`, `package.json`, and the four `src/*.ts` files.
4. After explicit authorization, publish interactively with 2FA:

   ```sh
   pnpm publish --access public --tag preview --publish-branch main
   ```

5. Install the exact registry version in a clean Pi package path:

   ```sh
   pi install npm:pi-exa-web@0.0.1
   ```

6. With `EXA_API_KEY` unset, run one bounded `web_search` call and one bounded `web_fetch` call. Confirm that both report the `anonymous` route.
7. Reconcile the registry metadata and file set with the local dry-run output before configuring the formal release.

Published npm versions are immutable. If the registry artifact is wrong, fix the repository, increment to `0.0.2`, repeat the gates, and publish the replacement under `preview`; do not attempt to reuse `0.0.1`.

## Trusted Publisher Setup

After the preview package exists, make these external configuration changes before running the formal-release workflow:

1. Create the public repository environment `npm-production` in GitHub.
2. Require one reviewer for the environment and limit deployment branches to `main`. A sole maintainer must not enable prevention of self-review unless another eligible reviewer exists.
3. In the npm settings for `pi-exa-web`, configure a GitHub Actions Trusted Publisher with:
   - organization or user: `hudrazine`
   - repository: `pi-exa-web`
   - workflow filename: `publish.yml`
   - environment: `npm-production`
   - allowed action: `npm publish`
4. Do not add an npm token to GitHub. The publish job authenticates only through OIDC.

The names are exact and case-sensitive. The workflow and npm Trusted Publisher environment must match.

## Formal 0.1.0 Release

1. Change `package.json` from `0.0.1` to `0.1.0`, repeat the local release gates, and merge the final release files to `main`.
2. Manually dispatch `.github/workflows/publish.yml` from `main`.
3. Inspect the completed `Verify release` job, including its check, test, and dry-run package output.
4. Approve the waiting `npm-production` deployment.
5. The publish job uses Vite+ to repeat installation and the `prepublishOnly` gates, then runs `vp pm publish` with the `latest` dist-tag. Only this job has `id-token: write`.
6. Install `pi-exa-web@0.1.0` from the registry and repeat the bounded anonymous smoke test.
7. Create the `v0.1.0` Git tag and GitHub Release with concise initial-release notes after registry verification.
8. After trusted publication succeeds, set npm publishing access to require 2FA and disallow traditional tokens.

## Verification

A release is verified only when local checks, dry-run package contents, registry metadata, installed registry contents, Pi tool registration, and both bounded anonymous calls agree with the release source. The preview must remain outside the `latest` dist-tag, and `latest` must resolve to `0.1.0` after the formal release.

## Failure Handling

- Do not fall back to an npm token when OIDC authentication fails. Check the exact repository, `publish.yml`, `npm-production`, `id-token: write`, and GitHub-hosted runner configuration, then rerun the workflow.
- Do not approve the environment when the verification job or its package-file inspection is incomplete.
- A failed publish that did not create the npm version may be retried after correcting the workflow or external configuration.
- Do not archive the initial release plan until the registry-installed package has passed its smoke tests.
