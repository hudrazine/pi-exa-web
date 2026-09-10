# pi-exa-web

Web search and single-page retrieval for [Pi](https://pi.dev), powered by [Exa](https://exa.ai/).

Choose how Pi accesses Exa. Start anonymously to conserve account credits, with automatic fallback to OAuth or an API key when anonymous access is rate-limited. Or prefer authenticated access from the start. No credentials are needed to get started.

## Installation

Requires Node.js **24.15.0 or later**.

```sh
pi install npm:@hudrazine/pi-exa-web
```

## Usage

Ask Pi to search or read a page:

```text
Search the web for TypeScript documentation.

Read https://example.com and summarize the page.
```

Pi chooses the tool and shows whether the result used anonymous access, OAuth or an API key.

| Tool         | Purpose        | Required input | Optional limit                       |
| ------------ | -------------- | -------------- | ------------------------------------ |
| `web_search` | Search the web | `query`        | `numResults`: 1–20 results           |
| `web_fetch`  | Read one page  | `url`          | `maxCharacters`: 1–20,000 characters |

Omitted limits use Exa's defaults. Successful text is returned as provided by Exa.

## Authentication

Authentication is optional. The default strategy starts anonymously. Authenticated requests may consume your Exa account credits.

### OAuth login

Run `/exa login` in a local interactive Pi terminal and complete authorization in your browser. If the browser does not open, open the URL displayed in Pi manually. Login expires after five minutes and can be stopped with Pi's cancel key.

RPC, JSON and print modes cannot start login. First log in through local interactive Pi using the same agent directory. Those modes can then use saved credentials and refresh them automatically. Remote callback relays and automatic SSH forwarding are not provided.

### API key

Create a key in the [Exa dashboard](https://dashboard.exa.ai/api-keys) and set it in the environment **before starting Pi**.

Bash:

```sh
export EXA_API_KEY="your-api-key"
```

PowerShell:

```powershell
$env:EXA_API_KEY = "your-api-key"
```

### Choosing a strategy

| Strategy | Behavior |
| --- | --- |
| `anonymous-first` (default) | Prefer anonymous access. Temporarily prefer available authentication after an anonymous rate limit. |
| `authenticated-first` | Prefer available authentication, otherwise use anonymous access. |

When authentication is needed, saved OAuth takes priority over the API key, with refresh when possible. If neither is available, calls use anonymous access. Invalid or unreadable saved state stops the operation.

Set your preference with `/exa strategy authenticated-first` or `/exa strategy anonymous-first`. Changes are saved and apply to subsequent calls.

An anonymous rate limit may cause one short retry before switching to available authentication. Certain authenticated credit-exhaustion errors permit an anonymous fallback. Authenticated rate limits do not permit fallback. Expand a result to see any fallback reason. See the [routing contract](docs/engineering/design/anonymous-first.md) for exact retry conditions.

## Commands

| Command                 | Action                                                            |
| ----------------------- | ----------------------------------------------------------------- |
| `/exa login`            | Sign in with OAuth in local interactive Pi                        |
| `/exa logout`           | Remove local OAuth credentials while keeping strategy and API key |
| `/exa status`           | Show strategy, local OAuth state and API-key presence             |
| `/exa strategy`         | Show the current strategy                                         |
| `/exa strategy <value>` | Save `anonymous-first` or `authenticated-first`                   |

In interactive Pi, type `/exa ` for subcommand completion or `/exa strategy ` for strategy values. Status checks only local state. It does not check credits or guarantee that Exa will accept a token.

## Local data and privacy

Search queries and requested page URLs are sent to Exa Hosted MCP.

Settings and OAuth credentials are stored under `exa-web` in Pi's agent directory, respecting `PI_CODING_AGENT_DIR`. API keys are not saved. Logout removes local credentials but does not revoke tokens on Exa's server.

Storage supports local filesystems only. On POSIX, the state directory uses `0700` and secret files use `0600`. Insufficient protection prevents saving. Windows relies on the Pi directory's inherited ACLs. See the [storage contract](docs/engineering/design/oauth-state.md) for details.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Anonymous rate limit | Retry later or configure [authentication](#authentication) |
| Status says login is required | Run `/exa login` again in local interactive Pi |
| Login is unavailable in your Pi mode | Use the [local login procedure](#oauth-login) with the same agent directory |
| API key is not detected | Check the environment that starts Pi, then start a new Pi process |
| Tools do not appear | Confirm installation and start a new Pi session |
| Settings or credentials cannot be saved | Check the state directory's access permissions and use a supported local filesystem |

Do not delete or replace the OAuth coordination database or its journal files to clear a lock.

## Development

See the [engineering documentation](docs/engineering/README.md) for design and the [development checks](docs/engineering/quality.md) for contributing.

## License

[MIT](LICENSE)
