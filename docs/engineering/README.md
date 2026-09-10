# Engineering Documentation

`@hudrazine/pi-exa-web` provides Pi-native web search and single-page retrieval through Exa Hosted MCP. The `0.2.0` feature implementation is complete; Hosted OAuth verification and publication remain pending. The [release plan](plans/oauth-tickets.md) owns current progress, and [verification evidence](records/0.2.0-verification.md) distinguishes tested behavior from unverified deployment compatibility.

## Understand the Project

Start with [product and scope](product.md), then [architecture](architecture.md). Use the following contracts for a particular behavior:

| Question | Authoritative document |
| --- | --- |
| What inputs, successful results and errors do tools expose? | [Pi tool contract](design/web-tools.md) |
| How are credentials selected, and when can a call retry or fall back? | [Authentication and routing](design/anonymous-first.md) |
| How do login, refresh and logout work? | [OAuth lifecycle and state](design/oauth-state.md) |
| How are files replaced and concurrent OAuth updates coordinated? | [State transactions](design/oauth-state.md#transactions-and-revisions), [SQLite lock contract](design/oauth-state-locking.md) |
| How do commands, local status and argument completion behave? | [Management commands](design/management.md) |
| Why use SQLite while retaining JSON? | [SQLite decision record](decisions/sqlite-state-locking.md) |

## Develop and Release

[Quality and development](quality.md) defines local checks, the supported-runtime matrix and verification responsibilities. [Release procedure](releases.md) defines Hosted smoke, publication approval and registry verification. [Remaining release work](plans/oauth-tickets.md) identifies what must happen next.

The [package README](../../README.md) owns installation and end-user guidance. [Package configuration](../../package.json) owns dependency versions, runtime requirements and publication metadata. The extension exposes no supported library import API.

## Evidence

[0.2.0 verification](records/0.2.0-verification.md) records the implementation baseline and its limits. [Initial release verification](records/initial-release.md) preserves the identity and publication evidence for `0.1.0`. Historical evidence is not a statement of current registry tags.
