# Changesets Release Verification Plan

**Status:** Active; automation implemented, first managed publication unverified

## Outcome and Current Evidence

Verify the first live release that uses Changesets from release-PR creation through registry-installed Pi execution. The [release procedure](../releases.md) owns the maintained workflow and operator steps; this plan owns only outstanding verification.

Recorded local verification passed checks, tests, frozen installation, package inspection, workflow parsing/permission assertions, and an isolated patch-version simulation. [Release run 32694790843](https://github.com/hudrazine/pi-exa-web/actions/runs/32694790843) completed mode selection using Vite+-managed pnpm, selected no release work, and skipped version, verify, and publish jobs.

The [initial release](../records/initial-release.md) verified approval-gated OIDC publication. It did not exercise Changesets release-PR creation or the full managed release path. No extra npm publication is needed solely to close this plan; verify the next authorized package release.

## Remaining Work

- [ ] Observe Changesets create or update a release pull request for a releasable change. Confirm the proposed version and GitHub-linked changelog, then complete required CI review and merge.
- [ ] Complete the [release procedure](../releases.md#review-and-publish-a-release), including its permission boundaries and authorized deployment approval.
- [ ] Complete the procedure's [post-publication verification](../releases.md#verification), including artifact consistency and registry-installed anonymous Pi smoke tests.
- [ ] Record the release version and verification evidence, update relevant guidance if needed, and close this plan. Retain only evidence with continuing maintenance value.

## Completion Criteria

A successful release uses Changesets-owned version/changelog updates and produces consistent release artifacts without a long-lived npm token. Routine operator work is changeset authoring, release-PR review/merge, and one environment approval; it requires no per-release workflow edits. A registry-installed package must pass the smoke tests before this plan is complete.
