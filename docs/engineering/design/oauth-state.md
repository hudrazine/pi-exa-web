# OAuth Lifecycle and State

This contract defines explicit login, non-interactive refresh, local logout and persistent state. The implementation uses the pinned MCP SDK for OAuth protocol handling and JSON for committed state. [Routing](anonymous-first.md) determines when authentication is needed; [management commands](management.md) define user interaction. [Quality criteria](../quality.md) and [release smoke](../releases.md#hosted-oauth-smoke) distinguish local verification from Hosted compatibility.

## OAuth Lifecycle

Use MCP SDK OAuth facilities for discovery, PKCE, client registration, token exchange, refresh, and protocol validation. For explicit login, use a staged `OAuthClientProvider` with SDK `auth()` / `finishAuth()`. For committed runtime connections, use the SDK's smaller `AuthProvider`: `token()` reads the selected credential and `onUnauthorized()` enters the same private refresh transaction used for proactive refresh. That transaction calls SDK `refreshAuthorization()` with the saved, validated issuer/resource metadata and client registration. Transport owns the single 401 replay.

The SDK's [auth implementation][sdk-auth] can invalidate credentials or continue toward authorization after refresh failure. Merely setting insufficient-scope handling to throw does not disable that 401 path. Keep general `auth()` in explicit login; runtime refresh has no registration, authorization redirect, or browser path.

Preserve issuer/resource binding when saving and refreshing tokens. Retain the existing refresh token if the server omits a replacement, as the SDK helper does. Declare both authorization-code and refresh-token grants in login client metadata; SDK scope selection can request `offline_access` when advertised.

Provide the caller/lifecycle signal to refresh through its `fetchFn` and to lock waits through private operation context, since SDK auth callbacks do not themselves carry a signal. The request's private async context carries the credential revision so a 401 can reuse a newer committed token instead of refreshing it again. Route switching remains the executor's responsibility. The SDK [transport][sdk-transport] limits 401 replay through `isAuthRetry`; package tests verify the signal/revision composition.

### Explicit Login

Login stages credentials in memory and saves them only after independent connection validation. One five-minute deadline covers the whole operation, including discovery, exchange, validation and commit waits. User cancellation, caller cancellation and shutdown abort the operation. A second login on the same private client is rejected without replacing the first.

1. Read the starting OAuth revision. Following [RFC 8252 §§7.3–8.4][native-oauth], bind a callback listener to `127.0.0.1` with port `0`, then construct the exact `/callback` redirect URI from the bound port before discovery or registration.
2. Create an operation-local provider. Reuse stored registration only if it explicitly permits that exact URI and matches the resolved issuer; otherwise stage new registration. Never seed the provider with stored tokens, even for re-login. SDK save/invalidation callbacks affect only memory. Verifier, random state, authorization code, discovery and new credentials remain staged.
3. Accept one GET on `/callback`. Check state, duplicate parameters and code/error contradictions before passing `URLSearchParams` to SDK `finishAuth` for issuer/error validation. A duplicate callback detected before commit fails the operation without restarting exchange. Unrelated paths/methods are rejected without consuming the callback. Fixed response text reports receipt, never saved-login success.
4. Validate the staged schema, then initialize a fresh OAuth Client/transport without sending search/fetch. Its provider reads only the staged token and throws on unauthorized or insufficient scope; it cannot refresh, register or log in. This connection never enters the normal route cache. Close it, the completion transport and listener before acquiring the commit lock.
5. Commit under the starting expected revision, then retire older local OAuth connections. No persistent OAuth lock is held while waiting for browser interaction.

Callback or bind failure, denial, timeout, abort, validation failure and revision conflict discard staging while preserving saved credentials. Saving or required cleanup failures use `storage`; internal cancellation retains the original abort reason. A successful rename is not undone by a later abort.

### Refresh and Logout

Credentials expire when `expiresAt <= Date.now()`, with no proactive margin. Missing expiry is locally usable until a server 401. `loginRequired` takes precedence; expired credentials without a refresh token are unavailable. Recheck state after acquiring the lock, and never revive logged-out or login-required credentials. Refresh results that are already expired do not trigger an additional refresh loop.

All refresh paths, including SDK-triggered 401 recovery, must participate in the same transaction discipline. After acquiring the OAuth lock, reload the latest revision and reuse another process's refreshed credentials when possible. Hold the lock across refresh and commit so a rotating refresh token is not concurrently consumed. Stage SDK token writes; update the committed in-memory view only after successful persistence. If refresh rotated the remote token but the local write fails, report storage failure and require recovery/login as necessary; atomic local writes cannot undo remote rotation. Do not retry the old token automatically in that operation.

The SDK receives the saved issuer, resource, client information and discovery metadata; runtime refresh does not rediscover or re-register. Preserve the issuer binding in returned tokens. Calculate a new absolute expiry from response receipt when `expires_in` is present; otherwise remove the previous absolute expiry. SDK `InvalidGrant`, `InvalidClient` and `UnauthorizedClient` rejection commits `loginRequired: true` once. Network failures, HTTP 429 and 5xx leave stored credentials unchanged for a later logical call. Do not classify rejection by response text.

Refresh failures become safe callback outcomes until necessary storage and lock cleanup finish. Storage or cleanup failure takes precedence over the refresh outcome; preserve the original abort reason internally. Only a successfully committed token can be used. The [routing contract](anonymous-first.md#authenticated-credential-resolution) bounds alternative credential selection and post-send 401 recovery.

Logout atomically commits an empty OAuth record with a higher revision, then invalidates local OAuth state. It is local logout, not a promise of server-side token revocation. Other processes observe the new revision before subsequent authenticated operations; already-sent requests may finish. Strategy and API key are unchanged, so authenticated-first may select the API key after logout.

## Persistence and Multiple Pi Processes

`src/state-schema.ts` defines credentials with `resource`, SDK `tokens`, SDK `clientInformation`, SDK `discovery`, optional absolute epoch-millisecond `expiresAt`, and boolean `loginRequired`. The schema requires the configured HTTPS OAuth resource, safe issuer/endpoint URLs without credentials or fragments, Bearer tokens and matching token/client/discovery issuer bindings. SDK-stamped issuer fields are retained separately from wire-schema validation and must match discovery. Validation rejects invalid fields, coercions and stripped properties. `tests/fixtures/oauth-state.ts` pins SDK 2.0.0 serialization; these fixtures do not establish Hosted compatibility.

Use `getAgentDir()` from Pi and a private `exa-web` child directory, independent of the project working directory. Do not use the repository, Pi session log, model-provider auth file, or a caller-configurable state path. Respect Pi's agent-directory override through that helper. Different agent directories are isolated. Do not use the separate ExaFuse project's state directory or automatically import its credentials.

Persist only on explicit strategy writes, successful OAuth commits, or required OAuth state updates. Missing files mean defaults/not configured; read-only operations do not create the directory. Unknown schema versions, malformed JSON, invalid fields, and unreadable files are errors, not permission to delete or silently treat the user as logged out. Report the error without echoing file contents. Do not silently spend API-key resources when the intended saved state cannot be read.

| File | Version 1 envelope |
| --- | --- |
| `settings.json` | `version`, `strategy`; last successful atomic replacement wins |
| `oauth.json` | `version`, monotonically increasing `revision`, `credentials` (null when logged out) |

Do not persist API keys, authorization URLs/codes, PKCE verifier or OAuth state. Preserve a null-credentials revision on logout rather than deleting the file, avoiding revision reuse after logout/re-login. An absent OAuth file has revision zero. No per-request revision write is needed when credentials do not change.

### Transactions and Revisions

Normalize the directory identity through the real existing parent/directory so equivalent local paths coordinate. OAuth writes use one SQLite coordination database with a separate connection for each transaction, both within one process and across processes; no same-process mutex is added. Use a 10-second lock-acquisition budget with abort support; timeout fails the OAuth operation and never permits an unlocked OAuth write. The [SQLite lock contract](oauth-state-locking.md) defines acquisition, cleanup, and synchronous I/O limits. Required semantics are: retain exclusion throughout the OAuth transaction, never steal from a live owner, and recover after process death without age-based deletion.

Every OAuth update acquires the OAuth lock and reloads the latest state before its callback. Returning no change preserves the record and revision; new or null credentials increment the latest revision by one. Revisions must be non-negative safe integers; overflow is a safe `storage` failure without saving. Settings writes have no revision or lock: validate existing settings and the proposed version 1 JSON, then replace the whole settings record. Invalid or unreadable existing settings remain storage errors; a strategy command is not a corruption-repair path. Concurrent valid strategy writes use last-write-wins, defined by the order of successful target replacements, not command start or notification order. No merge or conflict detection is required for this single-value setting. A successful command confirms its own replacement, not that another writer cannot immediately replace it.

Both kinds of write use an operation-owned restricted temporary file in the same directory, create it exclusively, write and close it, and replace the target with one `fs.rename`. Use same-filesystem replacement for complete-file visibility, subject to the platform limits below. Settings reads and writes do not load SQLite or create a coordination database, and remain independent of an OAuth refresh holding its lock.

On replacement error, return a storage error immediately: no automatic rename retry, deletion of the target, or truncate-and-write fallback. Readers see either a complete old or complete new record. A failed write does not alter the target or report success; another concurrent settings writer may still replace the target successfully. Clean only temporary files owned by the failed operation. This contract covers process interruption and complete reads; it does not claim power-loss durability without separate filesystem evidence.

Interactive login records its starting OAuth revision without holding the browser wait under lock. After validation, acquire the OAuth lock and compare against the latest revision. If changed, return `storage-conflict`, discard staging, and preserve the newer state; the user can start login again. Logout and refresh serialize under the OAuth lock. Strategy writes follow the last-write-wins replacement rule and affect memory only after the write succeeds. Each logical call reads settings again and keeps its own strategy snapshot; a process-local value must not override a newer file.

Before authenticated selection and before using a cached OAuth connection, read the latest OAuth revision and retire stale connections as specified in the [connection contract](../architecture.md#connection-and-cancellation). This observation does not cancel a request already in flight or create a global barrier against a simultaneous logout. [Local status](management.md#local-status) reads state without authentication resolution.

### Platform Limits

Target local filesystems on Linux, macOS, and Windows. On POSIX, use `0700` for the state directory and `0600` for secret and temporary files; verify restrictive access before storing secrets, and refuse saving when existing protection is insufficient. On Windows, rely on the Pi agent directory's inherited ACLs; Node mode bits do not establish owner-only access. Do not claim Windows has POSIX-equivalent `0600` protection. Network filesystems are unsupported; do not add unreliable filesystem-type detection as a substitute for that support boundary.

**Filesystem basis:** [Node rename][node-rename] and its POSIX contract support atomic name replacement. On Windows, [libuv `fs__rename`][uv-rename] uses `MoveFileExW` with replacement enabled; [Microsoft's contract][win-rename] specifies replacement and failure reporting. Complete-file visibility on supported local Windows storage is a high-confidence inference, not a universal guarantee. [Node's chmod limitation][node-chmod] explains why Windows protection relies on inherited ACLs. The [runtime checks](../quality.md#runtime-and-package-checks) require write/replace integration tests on the supported OSes. Supported-platform results are recorded in the [verification record](../records/0.2.0-verification.md).

[sdk-auth]: https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/client/src/client/auth.ts
[sdk-transport]: https://github.com/modelcontextprotocol/typescript-sdk/blob/cc4b41617ce3601b1290d67216ea0b194a3cd9ac/packages/client/src/client/streamableHttp.ts
[native-oauth]: https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3
[node-rename]: https://nodejs.org/docs/latest-v22.x/api/fs.html#fsrenameoldpath-newpath-callback
[uv-rename]: https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c
[win-rename]: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw
[node-chmod]: https://nodejs.org/docs/latest-v22.x/api/fs.html#fschmodpath-mode-callback
