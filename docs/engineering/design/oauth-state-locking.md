# SQLite State Lock Implementation Contract

This document defines the implementation contract for the [accepted SQLite coordination decision](../decisions/sqlite-state-locking.md). The [OAuth state contract](oauth-state.md#transactions-and-revisions) owns revisioned JSON transactions, and the [verification specification](../quality.md#lock-and-state-cases) owns acceptance checks. The private lock in `src/oauth-lock.ts` protects login commits, refresh and logout. Login's browser wait, settings operations and status reads do not acquire it.

## Acquisition and Cleanup

Keep `oauth.json` authoritative. Use persistent `oauth.lock.sqlite` in the canonical state directory solely for OAuth exclusion. Settings use validated JSON atomic replacement without a revision or lock, as defined by the [state design](oauth-state.md#transactions-and-revisions). No credentials, lock rows, timestamps, or schema migrations are needed. An in-memory or per-process DB cannot coordinate independent Pi processes.

1. Open a transaction-owned `DatabaseSync` connection to the canonical OAuth coordination DB. Use separate connections for concurrent operations even in the same process; do not add a local mutex. Keep normal rollback-journal mode; do not enable WAL, shared cache, exclusive connection locking, `ATTACH`, or journal disabling. Retain the connection until cleanup and do not share it between transactions.
2. Set `PRAGMA busy_timeout=0` and attempt `BEGIN IMMEDIATE`. The [Node binding][sqlite-binding] exposes `ERR_SQLITE_ERROR` with numeric `errcode`. Retry only primary SQLite BUSY code 5, including extended codes, using an abortable 50 ms delay shortened to the remaining budget. `SQLITE_LOCKED`, unavailable-module, permission, I/O, and corruption errors fail as storage errors; do not use message matching or fall back to unlocked access/another credential.
3. Apply the design's monotonic 10-second budget from the start of SQLite acquisition, including connection setup and polling. Check abort/deadline after synchronous calls and each await, before entering the protected operation. A timed-out or cancelled waiter cannot enter later. Zero busy timeout avoids SQLite sleeping on contention, but synchronous filesystem I/O is not interruptible and can exceed the budget.
4. Reread JSON under the acquired transaction and retain ownership through refresh, revision validation, write, and rename. The acquisition deadline is not a lease: a paused owner can make contenders time out. FIFO fairness is not promised.
5. After protected work settles or stops, roll back the coordination transaction if acquired, then close the connection even if rollback fails. Pre-acquisition failures still close the connection. Report cleanup failures safely; cleanup cannot undo a committed JSON revision or a remotely rotated token.

After owner death, SQLite and the OS release ownership and handle database recovery. A later call reuses the same DB; recovery need not finish within a current contender's budget. Keep DB and SQLite-managed journal files in place. Never delete/recreate them to resolve timeout or corruption. SQLite owns first-use initialization without an application table. The [state-directory protection](oauth-state.md#platform-limits) applies; coordination files carry no secrets.

## Constraints

- Use the accepted Node.js minimum of `>=24.15.0`. No enabling flag is required, but [the CLI permits disabling SQLite][sqlite-cli]. Load lazily for transactions and fail safely if unavailable; do not substitute an addon or unlocked access.
- Keep contention waits and JSON I/O asynchronous. Holding a transaction across an asynchronous refresh does not itself block the event loop. Synchronous I/O and runtime tradeoffs are recorded in the [decision](../decisions/sqlite-state-locking.md#consequences).
- The design supports local filesystems only. Follow [SQLite's locking constraints][sqlite-hazards]: access existing coordination DB contents only through `node:sqlite`; a raw open/close in the same process can release POSIX locks. Do not mix SQLite bindings on these files, use hard-link aliases, or copy/delete/rename active DB files. All cooperating processes must use the same canonical path and protocol.

[sqlite-binding]: https://github.com/nodejs/node/blob/v24.15.0/src/node_sqlite.cc
[sqlite-cli]: https://nodejs.org/download/release/v24.15.0/docs/api/cli.html#--no-experimental-sqlite
[sqlite-hazards]: https://www.sqlite.org/howtocorrupt.html#_file_locking_problems
