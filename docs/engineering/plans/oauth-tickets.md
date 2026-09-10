# 0.2.0 Release Plan

The feature implementation and local/CI/package preparation are complete. Hosted OAuth verification and publication remain pending. Current behavior is specified in [design](../README.md#understand-the-project); this plan owns remaining work, not a second copy of the specifications.

## Release Gates

| Gate | Status | Completion evidence or next action |
| --- | --- | --- |
| T1–T11: tools, routing, OAuth, state and supported-runtime CI | Done | [Implementation evidence](../records/0.2.0-verification.md#implementation-baseline) |
| T12: documentation, package contents and release intent | Done | [Merged PR #21](https://github.com/hudrazine/pi-exa-web/pull/21), `001838d`, with [four successful CI jobs](https://github.com/hudrazine/pi-exa-web/actions/runs/34449129363); includes command completion |
| T13: Hosted OAuth login and restart/refresh | Pending | Operator-run [Hosted OAuth smoke](../releases.md#hosted-oauth-smoke) |
| T14: release and first complete managed publication | Pending | [Release PR #18](https://github.com/hudrazine/pi-exa-web/pull/18) is open; follow [release procedure](../releases.md) after T13 and release approval |

T1–T14 are retained identifiers for existing PR references. Completed implementation tasks no longer define future work. [Verification evidence](../records/0.2.0-verification.md) records their review units and test scope. The target is `0.2.0`; the source manifest remains `0.1.0` until Changesets versioning is merged.

## T13 — Hosted OAuth Verification

Run the bounded smoke using an isolated local Pi agent directory, the intended package and no API key. The [procedure](../releases.md#hosted-oauth-smoke) owns exact steps, request limits and safe evidence fields.

Completion requires actual login, token/refresh-token presence, an OAuth search, restart with real refresh, an OAuth fetch and local status/logout cleanup. Operator account access is an execution condition. Missing refresh-token issuance or failed restart/refresh leaves the gate incomplete and requires review of the release claim. A general report that Pi works does not establish these specific checks.

## T14 — Authorized Publication and Registry Verification

Dependencies: T12 and T13 complete, with separate explicit release/deployment approval.

Review the Changesets-generated version, consumed changesets, linked changelog and required CI. Then follow the [publication and verification procedure](../releases.md#review-and-publish-a-release), including the pre-approval check/test/pack job and approval-gated OIDC publication.

Completion requires matching version, provenance, publication commit, npm artifact, tag, GitHub Release and changelog; an exact registry installation must pass one anonymous search and one anonymous fetch in a separate empty agent directory. Record the first managed release from release-PR generation through those results. Do not publish an extra version just to test automation.

Store safe execution evidence in a release record. Do not mark T13 or T14 complete until their own evidence exists.
