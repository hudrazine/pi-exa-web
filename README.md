# @hudrazine/pi-exa-web

Web search and page fetching for [Pi](https://pi.dev), powered by [Exa](https://exa.ai/).

`@hudrazine/pi-exa-web` adds two Pi-native tools backed by Exa Hosted MCP. It works without an API key and can use `EXA_API_KEY` when the anonymous rate limit is reached.

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

Pi chooses the appropriate tool and shows whether the completed request used anonymous access or an API key.

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

Requests start with anonymous access. An Exa API key is not required for normal installation or initial use.

If Exa reports that the anonymous rate limit has been reached, the package may wait briefly and retry anonymously. If anonymous access remains unavailable, it retries the tool call with `EXA_API_KEY` when the variable is configured. Without a key, the request fails with a message that links to the [Exa API key dashboard](https://dashboard.exa.ai/api-keys).

Set the environment variable before starting Pi:

```sh
export EXA_API_KEY="your-api-key"
```

PowerShell:

```powershell
$env:EXA_API_KEY = "your-api-key"
```

The key is read and trimmed once when the extension starts. Anonymous and API-key access use separate connections; the key is sent as an `x-api-key` header on the API-key connection, including initialization. It is not placed in request URLs. Search queries and fetched URLs are sent to Exa Hosted MCP to perform the requested operation.

## Behavior and limitations

- Exa's text response is returned without conversion to a package-owned result format.
- `web_fetch` accepts one URL per call.
- Anonymous rate-limit state is kept only in the current extension process and resets when the process ends.
- Cancellation is forwarded to the active Exa tool request.
- An expired MCP session is reconnected once only when Exa returns HTTP 404 for a request carrying a server-issued session ID. Other transport failures are not automatically replayed.
- Failures use package-owned messages without raw upstream errors, headers, or causes.
- The package does not provide caching, custom endpoints, alternate providers, or configurable retry settings.

## State storage foundation (unreleased)

The checkout includes private storage for upcoming OAuth and routing settings. Current web tools do not yet read or write that state, and OAuth management commands are not available.

State belongs in the `exa-web` child of Pi's agent directory, including its override. `settings.json` holds the strategy, `oauth.json` holds revisioned credentials, and `oauth.lock.sqlite` coordinates OAuth updates between processes. API keys are never saved. Settings do not require SQLite; OAuth transactions load Node's release-candidate `node:sqlite` lazily and fail safely if it is disabled.

Storage supports local filesystems only. POSIX state directories use `0700` and secret/temporary files use `0600`; insufficient existing protection prevents saving. Windows uses Pi's inherited ACLs, not POSIX-equivalent modes. Failed replacements preserve committed files. Do not delete or replace coordination databases or journals to clear a lock. The ten-second acquisition budget cannot interrupt synchronous filesystem I/O. Storage does not claim power-loss durability.

## Troubleshooting

### The anonymous rate limit was reached

Retry later, or set `EXA_API_KEY` before starting Pi. You can create a key from the [Exa dashboard](https://dashboard.exa.ai/api-keys).

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
