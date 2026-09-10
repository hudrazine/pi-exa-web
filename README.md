# @hudrazine/pi-exa-web

Web search and page fetching for [Pi](https://pi.dev), powered by [Exa](https://exa.ai/).

`@hudrazine/pi-exa-web` adds two Pi-native tools backed by Exa Hosted MCP. It works without credentials. This checkout also supports OAuth login and `EXA_API_KEY` for authenticated access in the next release.

## Installation

Install the package through Pi:

```sh
pi install npm:@hudrazine/pi-exa-web
```

The next release requires Node.js 24.15.0 or later. The version in this checkout remains `0.1.0` until the release PR updates it.

## Usage

Ask Pi to search the web or read a page. For example:

```text
Search the web for the latest TypeScript 7 documentation.

Fetch https://example.com and summarize the page.
```

Pi chooses the appropriate tool and shows whether the completed request used anonymous access, OAuth, or an API key.

## Tools

| Tool         | Purpose                                | Parameters                      |
| ------------ | -------------------------------------- | ------------------------------- |
| `web_search` | Search the web for current information | `query`, optional `numResults`  |
| `web_fetch`  | Read clean text from one web page      | `url`, optional `maxCharacters` |

### `web_search`

- `query`: Natural-language search query.
- `numResults`: Optional requested number of results, from 1 to 20.

### `web_fetch`

- `url`: URL of the page to read.
- `maxCharacters`: Optional maximum response length, from 1 to 20,000 characters.

When an optional limit is omitted, the package leaves the value unset so Exa can apply its current default.

## Authentication and rate limits

The default strategy starts with anonymous access. Credentials are not required for normal installation or initial use. These commands are implemented in this checkout for the next release:

```text
/exa login
/exa logout
/exa status
/exa strategy
/exa strategy anonymous-first
/exa strategy authenticated-first
```

Run `/exa login` in a local interactive Pi terminal. Pi displays a temporary authorization URL and attempts to open your browser; you can open the URL manually if that fails. Complete authorization within five minutes, or use Pi's cancel key to stop. Login uses a loopback callback on `127.0.0.1` and saves credentials only after checking the new connection. Failed re-login preserves existing credentials. A concurrent login, refresh or logout that changes saved credentials causes a conflict; start login again.

RPC, JSON and print modes cannot start login. Log in through local interactive Pi using the same agent directory first; saved credentials and refresh can then serve ordinary tools in those modes. Remote callback relays and SSH forwarding are not provided.

`/exa status` reads local state without contacting Exa. It shows the strategy, OAuth state, API-key presence and locally selectable authenticated route; it does not check credits or guarantee server acceptance. `/exa logout` removes local OAuth credentials after saving the new revision. It keeps the strategy and API key and does not revoke tokens on the server. Commands accept no extra arguments except the optional strategy value.

`authenticated-first` prefers usable saved OAuth credentials, refreshing expired credentials when possible, then the configured API key, then anonymous access. Strategy changes are saved in Pi's agent directory and apply to the next tool call, including calls from another Pi process using that directory. An in-flight call keeps its starting strategy.

On anonymous HTTP 429, the package probes once after the header's delay when it is at most two seconds. Without usable headers it waits one second and probes once; longer header delays skip the probe. A continuing limit allows one authenticated fallback, preferring saved OAuth over an API key. After that fallback, anonymous-first temporarily selects available authentication directly until the final header deadline, or one second after the last no-header 429. Without usable authentication, each call still tries anonymous access under the same probe limit. A successful anonymous primary does not read or refresh OAuth.

An authenticated tool error with Exa's exact credit-exhaustion prefix permits one anonymous fallback. Authenticated rate limits do not retry or fall back. A call never switches back to its earlier route. Pi shows the successful route and, when expanded, the fallback reason; the tool's successful text stays unchanged.

Set the environment variable before starting Pi:

```sh
export EXA_API_KEY="your-api-key"
```

PowerShell:

```powershell
$env:EXA_API_KEY = "your-api-key"
```

The key is read and trimmed once when the extension starts. Anonymous, OAuth and API-key access use separate connections; the key is sent as an `x-api-key` header on the API-key connection, including initialization. It is not placed in request URLs or OAuth requests. OAuth uses SDK Bearer authentication on `https://mcp.exa.ai/mcp/oauth`. Search queries and fetched URLs are sent to Exa Hosted MCP to perform the requested operation.

## Behavior and limitations

- Exa's text response is returned without conversion to a package-owned result format.
- `web_fetch` accepts one URL per call.
- Anonymous rate-limit state is kept only in the current extension process and resets when the process ends.
- Cancellation is forwarded to the active Exa tool request.
- An expired MCP session is reconnected once only when Exa returns HTTP 404 for a request carrying a server-issued session ID. OAuth permits one same-route SDK retry after a 401, using a refreshed or newer saved token. These retry limits do not reset one another; other transport failures are not automatically replayed.
- Failures use package-owned messages without raw upstream errors, headers, or causes.
- The package does not provide caching, custom endpoints, alternate providers, or configurable retry settings.

## Local state (unreleased)

Web tools read the saved strategy at each call boundary, and `/exa strategy` saves changes. Unreadable or invalid settings stop the call before network access and are not overwritten by the command. Saved OAuth credentials authenticate ordinary calls and refresh without interaction. Terminal refresh rejection marks them as requiring login. Refresh and local logout share a SQLite transaction through JSON replacement; a failed save stops the call without trying another route. Interactive login keeps new credentials in memory through authorization and connection validation, then compares the starting revision before saving. Browser waiting holds no SQLite lock. The OAuth flow is verified with local services; Hosted login and refresh smoke checks remain pending before release.

State belongs in the `exa-web` child of Pi's agent directory, including its override. `settings.json` holds the strategy, `oauth.json` holds revisioned credentials, and `oauth.lock.sqlite` coordinates OAuth updates between processes. API keys, authorization URLs/codes, state and PKCE verifiers are never saved. Settings and status do not require SQLite; status creates no files. OAuth transactions load Node's release-candidate `node:sqlite` lazily and fail safely if it is disabled.

Storage supports local filesystems only. POSIX state directories use `0700` and secret/temporary files use `0600`; insufficient existing protection prevents saving. Windows uses Pi's inherited ACLs, not POSIX-equivalent modes. Failed replacements preserve committed files. Do not delete or replace coordination databases or journals to clear a lock. The ten-second acquisition budget cannot interrupt synchronous filesystem I/O. Storage does not claim power-loss durability.

## Troubleshooting

### The anonymous rate limit was reached

Run `/exa login` in local interactive Pi, retry later, or set `EXA_API_KEY` before starting Pi. You can create a key from the [Exa dashboard](https://dashboard.exa.ai/api-keys).

### `EXA_API_KEY` is not detected

Make sure the variable is set in the same environment that starts Pi, then start a new Pi process so the extension can read it.

### The tools do not appear

Confirm that `@hudrazine/pi-exa-web` is installed, then start a new Pi session. The extension registers `web_search` and `web_fetch` when Pi loads it.

### Pi reports an unsupported Node.js version

Use Node.js 24.15.0 or later for this checkout and the next release.

## Development

Install dependencies and run the project checks:

```sh
vp install
vp run check
vp run test
```

Pi loads the TypeScript extension source directly through jiti. This package has no build step or generated `dist` directory. The automated tests use local transports and do not contact Hosted Exa or consume anonymous quota.

## License

[MIT](LICENSE)
