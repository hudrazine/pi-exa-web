# OAuth Lifecycle and State Design

**Status:** Accepted for `0.2.0`; PR1–PR5 merged with CI verified; Hosted smoke and release verification pending **Target:** `@hudrazine/pi-exa-web@0.2.0`

This document defines OAuth lifecycle, storage, and cross-process transaction behavior accepted on 2026-09-09. The accepted [routing design](oauth-routing.md) owns route selection, command behavior, error classification, and connection lifecycle. The [implementation plan](../plans/oauth-routing.md) owns delivery; the [verification specification](../plans/oauth-verification.md) owns acceptance checks. The merged, unreleased implementation includes the [SQLite coordination foundation](../decisions/sqlite-state-locking.md), non-interactive refresh, revision-aware connections, explicit login and management. Local and supported-platform CI checks passed; Hosted evidence remains a separate release condition.

## OAuth Lifecycle

Use MCP SDK OAuth facilities for discovery, PKCE, client registration, token exchange, refresh, and protocol validation. For explicit login, use a staged `OAuthClientProvider` with SDK `auth()` / `finishAuth()`. For committed runtime connections, use the SDK's smaller `AuthProvider`: `token()` reads the selected credential and `onUnauthorized()` enters the same private refresh transaction used for proactive refresh. That transaction calls SDK `refreshAuthorization()` with the saved, validated issuer/resource metadata and client registration. Transport owns the single 401 replay.

The SDK's [auth implementation][sdk-auth] can invalidate credentials or continue toward authorization after refresh failure. Merely setting insufficient-scope handling to throw does not disable that 401 path. Keep general `auth()` in explicit login; runtime refresh has no registration, authorization redirect, or browser path.

Preserve issuer/resource binding when saving and refreshing tokens. Retain the existing refresh token if the server omits a replacement, as the SDK helper does. Declare both authorization-code and refresh-token grants in login client metadata; SDK scope selection can request `offline_access` when advertised.

Provide the caller/lifecycle signal to refresh through its `fetchFn` and to lock waits through private operation context, since SDK auth callbacks do not themselves carry a signal. Carry the credential revision used by that request so a 401 can reuse a newer committed token instead of refreshing it again. Private async context may carry this information; route switching remains the executor's responsibility. The SDK [transport][sdk-transport] limits 401 replay through `isAuthRetry`; package tests must verify the signal/revision composition.

### Explicit Login

Following [RFC 8252 §§7.3–8.4][native-oauth], explicit login binds a callback listener to `127.0.0.1` with port `0`, obtains the bound port, and constructs the exact `/callback` redirect URI before discovery or registration. Reuse a stored client registration only if it explicitly permits that exact URI and matches the resolved issuer; otherwise stage a replacement. Never seed the login provider with stored tokens, including during re-login. SDK save/invalidation callbacks affect only staging. Keep verifier, random state, authorization code, discovery and new credentials in memory until completion. Only a GET on `/callback` can begin exchange; check state, duplicate parameters and code/error contradictions first, then pass `URLSearchParams` to SDK `finishAuth` for issuer/error validation. A duplicate callback detected before commit aborts the operation without restarting exchange. Unrelated paths/methods do not consume the callback. Responses use fixed text and report receipt, never saved-login success. Use one five-minute deadline from login start, cancellable by the user, caller and shutdown, through discovery, exchange, validation and commit waits. Reject a second login on the same private client without replacing the first.

Validate the staged record against the existing schema, then initialize a fresh OAuth Client/transport without sending search/fetch. Its minimal provider reads only the staged token and throws on unauthorized or insufficient scope; it cannot refresh, register or log in. The connection is never cached as a normal route. Close it, the completion transport and listener before committing with the starting expected revision. Browser callback failure, port bind failure, denial, timeout, abort, validation failure or revision conflict discards staging without replacing saved credentials. Saving or required cleanup failures use `storage`; retain original abort reasons internally. A successful rename is not undone. Successful login retires older local OAuth connections. Never hold the persistent OAuth lock while waiting for browser interaction.

### Refresh and Logout

All refresh paths, including SDK-triggered 401 recovery, must participate in the same transaction discipline. After acquiring the OAuth lock, reload the latest revision and reuse another process's refreshed credentials when possible. Hold the lock across refresh and commit so a rotating refresh token is not concurrently consumed. Stage SDK token writes; update the committed in-memory view only after successful persistence. If refresh rotated the remote token but the local write fails, report storage failure and require recovery/login as necessary; atomic local writes cannot undo remote rotation. Do not retry the old token automatically in that operation.

Logout atomically commits an empty OAuth record with a higher revision, then invalidates local OAuth state. It is local logout, not a promise of server-side token revocation. Other processes observe the new revision before subsequent authenticated operations; already-sent requests may finish. Strategy and API key are unchanged, so authenticated-first may select the API key after logout.

## Persistence and Multiple Pi Processes

PR2 implements the private persistence described here; PR3 uses settings for routing, PR4 adds OAuth refresh/selection, and PR5 connects staged login and management. `src/state-schema.ts` defines credentials with `resource`, SDK `tokens`, SDK `clientInformation`, SDK `discovery`, optional absolute epoch-millisecond `expiresAt`, and boolean `loginRequired`. SDK-stamped issuer fields are retained separately from wire-schema validation and must match discovery. Validation rejects invalid fields, coercions and stripped properties. `tests/fixtures/oauth-state.ts` pins SDK 2.0.0 serialization; these fixtures do not establish Hosted compatibility.

Use `getAgentDir()` from Pi and a private `exa-web` child directory, independent of the project working directory. Do not use the repository, Pi session log, model-provider auth file, or a caller-configurable state path. Respect Pi's agent-directory override through that helper. Different agent directories are isolated. Do not use the separate ExaFuse project's state directory or automatically import its credentials.

Persist only on explicit strategy writes, successful OAuth commits, or required OAuth state updates. Missing files mean defaults/not configured. Unknown schema versions, malformed JSON, invalid fields, and unreadable files are errors, not permission to delete or silently treat the user as logged out. Report the error without echoing file contents. Do not silently spend API-key resources when the intended saved state cannot be read.

| File | Version 1 envelope |
| --- | --- |
| `settings.json` | `version`, `strategy`; last successful atomic replacement wins |
| `oauth.json` | `version`, monotonically increasing `revision`, `credentials` (null when logged out) |

The OAuth credentials record holds SDK-required tokens/expiry, client registration, discovery data tied to the configured resource/issuer, and whether a terminal refresh rejection requires login. Persist discovery only as supported by the verified SDK representation; pin its private serialization with fixtures. Do not persist API keys, authorization URLs/codes, PKCE verifier, or OAuth state. Preserve a null-credentials revision on logout rather than deleting the file, avoiding revision reuse after logout/re-login. An absent OAuth file has revision zero. No per-request revision write is needed when credentials do not change.

### Transactions and Revisions

Normalize the directory identity through the real existing parent/directory so equivalent local paths coordinate. OAuth writes use one SQLite coordination database with a separate connection for each transaction, both within one process and across processes; no same-process mutex is added. Use a 10-second lock-acquisition budget with abort support; timeout fails the OAuth operation and never permits an unlocked OAuth write. The [SQLite lock contract](../design/oauth-state-locking.md) defines acquisition, cleanup, and synchronous I/O limits. Required semantics are: retain exclusion throughout the OAuth transaction, never steal from a live owner, and recover after process death without age-based deletion.

Every OAuth write acquires the OAuth lock, reloads state, and increments the latest revision. Settings writes have no revision or lock: validate existing settings and the proposed version 1 JSON, then replace the whole settings record. Invalid or unreadable existing settings remain storage errors; a strategy command is not a corruption-repair path. Concurrent valid strategy writes use last-write-wins, defined by the order of successful target replacements, not command start or notification order. No merge or conflict detection is required for this single-value setting. A successful command confirms its own replacement, not that another writer cannot immediately replace it.

Both kinds of write use an operation-owned restricted temporary file in the same directory, write and close it, and replace the target with `fs.rename`. Use same-filesystem replacement for complete-file visibility, subject to the platform limits below. Settings reads and writes do not load SQLite or create a coordination database, and remain independent of an OAuth refresh holding its lock.

On replacement error, return a storage error immediately: no automatic rename retry, deletion of the target, or truncate-and-write fallback. Readers see either a complete old or complete new record. A failed write does not alter the target or report success; another concurrent settings writer may still replace the target successfully. Clean only temporary files owned by the failed operation. This contract covers process interruption and complete reads; it does not claim power-loss durability without separate filesystem evidence.

Interactive login records its starting OAuth revision without holding the browser wait under lock. After validation, acquire the OAuth lock and compare against the latest revision. If changed, return `storage-conflict`, discard staging, and preserve the newer state; the user can start login again. Logout and refresh serialize under the OAuth lock. Strategy writes follow the last-write-wins replacement rule and affect memory only after the write succeeds. Each logical call reads settings again and keeps its own strategy snapshot; a process-local value must not override a newer file.

Before authenticated selection and before using a cached OAuth connection, read the latest OAuth revision and invalidate stale local state when it changes. This observation does not cancel a request already in flight or create a global barrier against a simultaneous logout. Status uses only local reads and distinguishes not configured, locally ready, expired/refreshable, and login required. A locally ready token is not proof of server acceptance.

### Platform Limits

Target local filesystems on Linux, macOS, and Windows. On POSIX, use `0700` for the state directory and `0600` for secret and temporary files; verify restrictive access before storing secrets. On Windows, rely on the Pi agent directory's inherited ACLs; Node mode bits do not establish owner-only access. Do not claim Windows has POSIX-equivalent `0600` protection. Network filesystems are unsupported; do not add unreliable filesystem-type detection as a substitute for that support boundary.

**Filesystem basis:** [Node rename][node-rename] and its POSIX contract support atomic name replacement. On Windows, [libuv `fs__rename`][uv-rename] uses `MoveFileExW` with replacement enabled; [Microsoft's contract][win-rename] specifies replacement and failure reporting. Complete-file visibility on supported local Windows storage is a high-confidence inference, not a universal guarantee. [Node's chmod limitation][node-chmod] explains why Windows protection relies on inherited ACLs. The [runtime checks](../plans/oauth-verification.md#runtime-and-package-checks) require write/replace integration tests on the supported OSes. PR2–PR5 CI verified their storage and integration cases, including [PR5's final revision](../plans/oauth-verification.md#pr5-verification).

[sdk-auth]: https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/client/src/client/auth.ts
[sdk-transport]: https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/client/src/client/streamableHttp.ts
[native-oauth]: https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3
[node-rename]: https://nodejs.org/docs/latest-v22.x/api/fs.html#fsrenameoldpath-newpath-callback
[uv-rename]: https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c
[win-rename]: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw
[node-chmod]: https://nodejs.org/docs/latest-v22.x/api/fs.html#fschmodpath-mode-callback
