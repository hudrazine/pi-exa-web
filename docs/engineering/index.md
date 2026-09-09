# Engineering Documentation

Start with [product and scope](product.md), then use the document that owns the question you need to answer.

## Implemented Package

| Question | Authoritative document |
| --- | --- |
| What is the package for, and what is outside its scope? | [Product and scope](product.md) |
| How do Pi, the client, and the authentication policy interact? | [Architecture](architecture.md) |
| What do callers and users observe? | [Pi tool contract](design/web-tools.md) |
| When can anonymous calls retry or use an API key? | [Anonymous-first authentication](design/anonymous-first.md) |
| How do maintainers develop and verify changes? | [Quality and development](quality.md) |
| How is a version reviewed, published, and checked? | [npm release procedure](releases.md) |

These documents describe implemented `0.1.0`. Exact dependency versions and development runtimes belong to [package configuration](../../package.json); user installation and usage belong to the [README](../../README.md).

## Planned Work and Decisions

- [OAuth and routing implementation plan](plans/oauth-routing.md): delivery order, remaining work, verification, and release conditions for `0.2.0`; implementation has not started.
- [OAuth and routing proposal](plans/oauth-routing-design.md): proposed Pi management interface, route selection, retries, failure classification, and connection lifecycle.
- [OAuth lifecycle and state proposal](plans/oauth-state.md): proposed login, refresh, logout, storage, and cross-process transaction semantics.
- [SQLite state-coordination decision](decisions/sqlite-state-locking.md): accepted for `0.2.0`, including its higher Node.js minimum; [implementation contract](plans/oauth-state-locking.md) remains unimplemented.
- [Changesets release verification plan](plans/changesets-release-automation.md): remaining end-to-end verification of the implemented release automation.

A proposal is not current behavior. An accepted decision records a selected design and its rationale, not implementation completion. Plans own remaining work and acceptance checks; after completion, verified contracts belong in the current design documents.

## Retained Evidence

[Initial release verification](records/initial-release.md) preserves artifact identity, package-name migration, and completed publication checks. Routine completed task lists and editing history are left to version control.
