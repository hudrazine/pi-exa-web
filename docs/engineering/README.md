# Engineering Documentation

`@hudrazine/pi-exa-web` is a source-loaded Pi extension for web search and single-page text retrieval through Exa Hosted MCP. It supports anonymous access, saved OAuth and an optional API key. The [package README](../../README.md) covers installation and everyday use; these documents explain the engineering contracts and how to maintain the package.

## Project Status

Version `0.2.0` is published and its implementation and release work are complete. No further implementation milestone is currently defined in these documents. The [release record](records/0.2.0-verification.md) identifies the evidence and the post-publication checks explicitly waived for this release. A closed release does not imply that waived checks were performed.

## Understand the Project

Start with [product requirements and scope](product.md), then [architecture](architecture.md). Detailed contracts have one owner each:

| Question | Authoritative document |
| --- | --- |
| What inputs, successful results and errors do tools expose? | [Pi tool contract](design/web-tools.md) |
| How are credentials selected, and when can a call retry or fall back? | [Authentication and routing](design/anonymous-first.md) |
| How do login, refresh and logout work? | [OAuth lifecycle and state](design/oauth-state.md) |
| How are files replaced and concurrent OAuth updates coordinated? | [State transactions](design/oauth-state.md#transactions-and-revisions), [SQLite lock contract](design/oauth-state-locking.md) |
| How do commands, local status and argument completion behave? | [Management commands](design/management.md) |
| Why use SQLite while retaining JSON? | [SQLite decision record](decisions/sqlite-state-locking.md) |

## Develop and Release

[Quality and development](quality.md) defines local commands, test obligations, the supported-runtime matrix and package checks. [Release procedure](releases.md) defines Changesets versioning, Hosted smoke, publication approval and registry verification.

[Package configuration](../../package.json) owns dependency versions, runtime requirements and publication metadata. The [Changesets policy](../../.changeset/README.md) determines when a change needs a release entry. The extension exposes no supported library import API.

## Historical Evidence

Release records describe observed results and their limits; they do not define current behavior or future registry tags. The [0.2.0 record](records/0.2.0-verification.md) covers OAuth and the first Changesets-managed publication. The [0.1.0 record](records/initial-release.md) preserves the initial OIDC publication and registry smoke evidence.
