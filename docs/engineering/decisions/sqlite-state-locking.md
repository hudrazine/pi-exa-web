# SQLite Coordination for OAuth State

**Status:** Accepted for `0.2.0`, with the 2026-09-09 amendment below. Implementation and supported-platform evidence are recorded [separately](../records/0.2.0-verification.md).

## Decision

Use Node's bundled `node:sqlite` solely to exclude concurrent OAuth transactions while keeping JSON authoritative. Each operation owns a separate connection to canonical `oauth.lock.sqlite`; no same-process mutex is needed. Settings contain one replaceable strategy and use validated last-write-wins JSON replacement without revisions or a lock.

The [lock contract](../design/oauth-state-locking.md) defines acquisition and cleanup. [OAuth state](../design/oauth-state.md) defines revision and commit semantics. Those documents own current behavior.

## Rationale

OAuth needs ownership throughout read/refresh/write, no takeover from a live owner, bounded cancellable acquisition and recovery after process death. SQLite delegates ownership and recovery to SQLite/OS locks, avoiding a private crash-recovery protocol and separately packaged native bindings. Moving credentials into SQLite is unnecessary.

[SQLite transactions](https://www.sqlite.org/lang_transaction.html) allow one writer per database. `BEGIN IMMEDIATE` acquires ownership without an application table; returning from the synchronous call does not end the transaction. The [pager](https://www.sqlite.org/lockingv3.html) uses OS locks. [Connection isolation](https://www.sqlite.org/isolation.html) also applies to separate connections in one process, so a local mutex would duplicate exclusion and introduce another queue/cleanup protocol. The tradeoff is that competing operations can open more connections and poll SQLite.

OAuth revisions and revisioned null-credential logout prevent stale login commits and rotating-token reuse. Settings do not require those guarantees: one successful complete replacement can supersede another, and settings remain usable while refresh owns the OAuth lock or SQLite is disabled.

## Consequences

The decision raises the Node minimum to `>=24.15.0`, accepting that release's [Stability 1.2 — Release candidate SQLite API](https://nodejs.org/download/release/v24.15.0/docs/api/sqlite.html). No native-addon build/ABI dependency is added. SQLite loads only for OAuth transactions and fails safely when unavailable.

Brief synchronous local I/O is accepted; contention waits and JSON I/O remain asynchronous. Slow filesystem calls can block Pi's event loop and exceed the acquisition budget. The deadline is not a hard response-time guarantee or a lease. Add no Worker without a concrete responsiveness problem.

SQLite rollback cannot undo a JSON rename or remote token rotation. Only local filesystems using one canonical coordination protocol are supported. Never replace this boundary with unlocked OAuth access. The [quality criteria](../quality.md#lock-and-state-cases) cover ownership across awaits, process death, commit failures and cleanup; Hosted compatibility remains a separate verification obligation.

## Decision History

The original accepted decision coordinated both settings and OAuth using separate SQLite databases and included a same-process mutex. The 2026-09-09 amendment supersedes only those settings-lock and local-mutex requirements: complete replacement is sufficient for the single settings value, and transaction-owned connections already exclude concurrent operations within a process. JSON authority, OAuth revisions, SQLite exclusion and the higher Node minimum remain unchanged. This history explains the supersession; it is not an alternate supported storage protocol.
