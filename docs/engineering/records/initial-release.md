# Initial Release Verification

**Status:** Completed

This record preserves release identity and verification evidence for `@hudrazine/pi-exa-web@0.1.0`. It is not a release procedure or a statement of current registry tags. Use the [release procedure](../releases.md) for subsequent publications.

## Verified Artifact

Version `0.1.0` was published from commit `ff3cdc73c3cf20b2c88bca1b2eaacb0a4b868563` through the approval-gated `publish.yml` OIDC workflow. Its seven-file npm artifact matched the publication commit and carried npm provenance. Git tag and GitHub Release `v0.1.0` targeted that commit.

Repository checks, tests, package inspection, and Pi's real extension loader passed. A local-path installation and then a clean installation of the registry `0.1.0` package each completed one bounded anonymous call with `web_search` and `web_fetch`, with no API key configured. Local real-SDK tests supplied fallback/concurrency/lifecycle evidence without deliberately exhausting Hosted quota.

## Package Identity and Publication Controls

The permanent package name is `@hudrazine/pi-exa-web`. The unscoped `pi-exa-web@0.0.1` was deprecated with `Moved to @hudrazine/pi-exa-web`. The scoped preview artifact's license and four source files matched the verified unscoped artifact byte for byte; the name-only preview migration reused that Pi smoke evidence. At release completion, scoped `preview` pointed to `0.0.1` and `latest` to `0.1.0`.

The publication used npm Trusted Publisher and the `npm-production` environment with one reviewer, self-review permitted, and deployments restricted to `main`. No npm token or GitHub secret was used. npm publishing access was set to require 2FA and disallow bypass-2FA tokens. The [release procedure](../releases.md#trusted-publisher-configuration) owns the maintained trust-binding requirements.

The first Changesets-managed release is a separate, [outstanding verification](../plans/changesets-release-automation.md); the initial OIDC publication does not establish that the full Changesets release-PR path works.
