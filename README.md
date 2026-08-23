# @hudrazine/pi-exa-web

Web search and page fetching for [Pi](https://pi.dev), powered by [Exa](https://exa.ai/).

`@hudrazine/pi-exa-web` adds two Pi-native tools backed by Exa Hosted MCP. It works without an API key and can use `EXA_API_KEY` when the anonymous rate limit is reached.

## Installation

Install the package through Pi:

```sh
pi install npm:@hudrazine/pi-exa-web
```

The package requires Node.js 22.19.0 or later.

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

The key is sent as an `x-api-key` header only for authenticated Exa tool calls. It is not placed in request URLs. Search queries and fetched URLs are sent to Exa Hosted MCP to perform the requested operation.

## Behavior and limitations

- Exa's text response is returned without conversion to a package-owned result format.
- `web_fetch` accepts one URL per call.
- Anonymous rate-limit state is kept only in the current extension process and resets when the process ends.
- Cancellation is forwarded to the active Exa tool request.
- The package does not provide caching, custom endpoints, alternate providers, or configurable retry settings.

## Troubleshooting

### The anonymous rate limit was reached

Retry later, or set `EXA_API_KEY` before starting Pi. You can create a key from the [Exa dashboard](https://dashboard.exa.ai/api-keys).

### `EXA_API_KEY` is not detected

Make sure the variable is set in the same environment that starts Pi, then start a new Pi process so the extension can read it.

### The tools do not appear

Confirm that `@hudrazine/pi-exa-web` is installed, then start a new Pi session. The extension registers `web_search` and `web_fetch` when Pi loads it.

### Pi reports an unsupported Node.js version

Use Node.js 22.19.0 or later, matching Pi's current runtime requirement.

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
