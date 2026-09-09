# SQLite Coordination for Local State

**Status:** Accepted for `0.2.0`, amended on 2026-09-09; PR2 foundation merged with OS CI verified; OAuth integration pending

## Original Decision — Partially Superseded

Use Node's bundled `node:sqlite` transactions to coordinate settings and OAuth JSON updates between Pi processes. Raise the target release's Node.js minimum to `>=24.15.0`, accepting that release's **Stability 1.2 — Release candidate** API. The implemented package still uses the runtime declared in [package.json](../../../package.json).

Keep JSON as the authoritative state format. Use separate coordination databases for settings and OAuth so a settings change does not wait behind token refresh. The [lock implementation contract](../design/oauth-state-locking.md) owns acquisition and cleanup; the [state proposal](../proposals/oauth-state.md) owns revision and commit semantics.

## Current Decision — 2026-09-09 Amendment

This amendment supersedes the original settings coordination requirement above and the same-process mutex requirement in the earlier lock design. JSON storage, SQLite for OAuth exclusion, and the higher Node.js minimum remain accepted. Nothing in this record establishes implementation or verification.

Use only `oauth.lock.sqlite`, with a transaction-owned connection for each OAuth operation. SQLite's [connection isolation](https://www.sqlite.org/isolation.html) applies to separate connections in the same thread/process as well as separate processes; `BEGIN IMMEDIATE` excludes other writers. Under this connection discipline, the additional local mutex duplicates exclusion and is removed. Canonical paths, abortable BUSY polling, bounded acquisition, and cleanup remain required. This avoids a second wait queue and acquisition/cleanup protocol; competing local operations may instead open more connections and poll SQLite.

Settings contain one replaceable strategy value and are read at every logical call boundary. They need neither OAuth's stale-credential detection nor login commit revision comparison. Use validated JSON atomic replacement with last-write-wins, without a settings revision, coordination DB, or lock. Concurrent successful settings writes may overwrite each other; no merge or conflict notification is promised. A failed writer must not overwrite or clean up another writer's result. Settings remain usable independently of OAuth lock contention or SQLite availability. The [state design](../proposals/oauth-state.md#transactions-and-revisions) defines exact write and failure semantics.

Keep OAuth revisions, null-credential logout records, and exclusion across refresh and commit. These protect against rotating-token reuse and stale login commits; they are not removed by the settings simplification.

## Context and Rationale

The OAuth state transactions require exclusion throughout read/refresh/write, no takeover from a live owner, recovery after owner death, and bounded cancellable acquisition. SQLite delegates ownership and crash recovery to SQLite/OS locks. This avoids a private crash-recovery protocol and separately packaged native bindings while retaining JSON storage; moving credentials into SQLite is unnecessary for these requirements.

[SQLite transactions](https://www.sqlite.org/lang_transaction.html) allow one writer per database. `BEGIN IMMEDIATE` acquires a write transaction without an application table, and returning from the synchronous call does not end the transaction. The [pager](https://www.sqlite.org/lockingv3.html) uses OS locks. Holding this transaction across asynchronous refresh and external JSON replacement is a source-backed composition inference, not an executed package result. SQLite rollback does not undo JSON replacement or remote token rotation.

## Consequences and Validation

Implementation update: PR2 provides private SQLite exclusion and JSON replacement. Local fixtures cover holding ownership across awaits and JSON commit, contention, process-death recovery and cleanup. This verifies that part of the composition inference above; PR2's [four-job CI passed](https://github.com/hudrazine/pi-exa-web/actions/runs/34322919016), while remote refresh/token rotation remain separate obligations in the [verification specification](../plans/oauth-verification.md).

[Node 24.15](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html) supplies synchronous database operations. Accept brief synchronous local I/O for coordination, with asynchronous contention waits and JSON I/O. Slow filesystem calls can block Pi's event loop and exceed the acquisition budget; the budget is not a hard response-time guarantee. Add no Worker without a concrete responsiveness problem.

There is no separate native addon build/ABI requirement, but the release-candidate API, Pi loader, process-death recovery, and supported local filesystems still need the [runtime and lock checks](../plans/oauth-verification.md#lock-and-state-cases). The protocol does not support network filesystems or unlocked OAuth fallback when SQLite is unavailable; settings replacement does not use SQLite. This decision originally accepted only coordination. The surrounding [OAuth and routing design](../proposals/oauth-routing.md) and [state lifecycle](../proposals/oauth-state.md) were subsequently accepted on 2026-09-09; OAuth lifecycle implementation and verification remain pending.
