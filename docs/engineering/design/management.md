# Pi Management Commands

The extension registers one `/exa` command. Commands use Pi command UI; they are not LLM-callable tools and add no assistant messages, tool results or persistent entries. [OAuth lifecycle](oauth-state.md) owns login/refresh/logout transactions; [routing](anonymous-first.md) owns strategy effects.

## Commands and Validation

| Command | Result |
| --- | --- |
| `/exa login` | Start explicit OAuth in local interactive Pi |
| `/exa logout` | Commit null OAuth credentials, then retire local OAuth connections |
| `/exa status` | Show local strategy, OAuth state, startup API-key presence and authentication candidate |
| `/exa strategy` | Show the saved strategy, or `anonymous-first` when absent |
| `/exa strategy anonymous-first` or `authenticated-first` | Replace settings, then notify success |

Login/logout/status accept no arguments. Strategy accepts zero or one supported value. Unknown subcommands, invalid values, no subcommand or extra arguments show fixed usage without saving or echoing input. Leading/repeated whitespace is allowed; values are case-sensitive. Storage errors use fixed notifications without raw paths, arguments, bodies or causes.

Writes notify success only after successful JSON replacement. Logout preserves strategy and the API key, and does not revoke remote tokens. A concurrent login cannot revive a pre-logout revision. Private operations reject work after close and check lifecycle cancellation before saving.

## Interactive Login UI

Login starts only when `ctx.mode === "tui"`; `hasUI` is insufficient because RPC can also report it. Other modes give guidance to use local interactive Pi with the same agent directory, without opening a listener, browser or authorization connection. Saved credentials and non-interactive refresh remain usable in those modes.

Use `ctx.ui.custom` for a temporary authorization URL and waiting screen. Accept only HTTPS URLs without username/password for display and browser opening. Connect Pi's cancel key and screen disposal to cancellation; remove the screen on completion. Success, timeout, cancellation, authorization denial and revision conflict use fixed notifications. A callback receipt is not saved-login success. The five-minute deadline and staging/commit rules are specified in [explicit login](oauth-state.md#explicit-login).

After displaying the URL, attempt `open` on macOS, `rundll32` on Windows or `xdg-open` on Linux using argument arrays, no shell and discarded process output. Browser opening is best effort; failure leaves the URL available for manual opening. Do not depend on Pi's private browser helper.

## Local Status

Status reads settings and OAuth only: no refresh, MCP connection, SQLite acquisition or file creation. It returns no token, secret or storage path and makes no claim about balance or server acceptance.

| Saved state                                         | Displayed OAuth state      |
| --------------------------------------------------- | -------------------------- |
| No credentials                                      | Not configured             |
| `loginRequired`, or expired without a refresh token | Login required             |
| Expired with a refresh token                        | Expired; refresh available |
| Unexpired or no expiry specified                    | Locally available          |

`loginRequired` takes precedence over expiry. The local authentication candidate prefers available/refreshable OAuth, then the startup key, then none; it is not proof that a request will succeed.

## Argument Completion

Pi's synchronous `getArgumentCompletions` supplies fixed, case-sensitive prefix matches with short English descriptions. Login identifies interactive Pi, logout identifies local removal, and status identifies local inspection.

| Argument input | Candidates, in order |
| --- | --- |
| Empty or whitespace only | `login`, `logout`, `status`, `strategy` |
| `lo` | `login`, `logout` |
| `st` | `status`, `strategy` |
| `strategy ` | `anonymous-first`, `authenticated-first` |
| `strategy au` | `authenticated-first` |
| No-argument command followed by whitespace, unknown value or extra argument | None |

Leading and repeated whitespace are accepted and normalized to single spaces on insertion. Trailing whitespace begins the next argument. Exact matches remain candidates; completion adds no trailing space. Strategy labels contain only the value, while insertion replaces the full argument prefix, for example `strategy authenticated-first`. No candidates returns `null`.

Completion reads no state or credentials, performs no network/storage operations and invokes no command or UI action. [Management tests](../../../tests/management-command.test.ts) exercise the registered callback and Pi's actual completion application.
