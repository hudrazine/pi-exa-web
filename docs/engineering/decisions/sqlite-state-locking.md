# SQLite Coordination for Local State

**Status:** Accepted for `0.2.0`; implementation pending

## Decision

Use Node's bundled `node:sqlite` transactions to coordinate settings and OAuth JSON updates between Pi processes. Raise the target release's Node.js minimum to `>=24.15.0`, accepting that release's **Stability 1.2 — Release candidate** API. The implemented package still uses the runtime declared in [package.json](../../../package.json).

Keep JSON as the authoritative state format. Use separate coordination databases for settings and OAuth so a settings change does not wait behind token refresh. The [lock implementation contract](../design/oauth-state-locking.md) owns acquisition and cleanup; the [state proposal](../proposals/oauth-state.md) owns revision and commit semantics.

## Context and Rationale

The proposed state transactions require exclusion throughout read/refresh/write, no takeover from a live owner, recovery after owner death, and bounded cancellable acquisition. SQLite delegates ownership and crash recovery to SQLite/OS locks. This avoids a private crash-recovery protocol and separately packaged native bindings while retaining JSON storage; moving credentials into SQLite is unnecessary for these requirements.

[SQLite transactions](https://www.sqlite.org/lang_transaction.html) allow one writer per database. `BEGIN IMMEDIATE` acquires a write transaction without an application table, and returning from the synchronous call does not end the transaction. The [pager](https://www.sqlite.org/lockingv3.html) uses OS locks. Holding this transaction across asynchronous refresh and external JSON replacement is a source-backed composition inference, not an executed package result. SQLite rollback does not undo JSON replacement or remote token rotation.

## Consequences and Validation

[Node 24.15](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html) supplies synchronous database operations. Accept brief synchronous local I/O for coordination, with asynchronous contention waits and JSON I/O. Slow filesystem calls can block Pi's event loop and exceed the acquisition budget; the budget is not a hard response-time guarantee. Add no Worker without a concrete responsiveness problem.

There is no separate native addon build/ABI requirement, but the release-candidate API, Pi loader, process-death recovery, and supported local filesystems still need the [runtime and lock checks](../plans/oauth-verification.md#lock-and-state-cases). The protocol does not support network filesystems or unlocked fallback when SQLite is unavailable. General OAuth behavior remains proposed; this decision does not mark that proposal accepted or implemented.
