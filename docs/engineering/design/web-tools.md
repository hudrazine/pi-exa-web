# Pi Tool Contract

The implemented `0.1.0` extension registers `web_search` and `web_fetch`. They expose Exa search and single-page text retrieval through Pi; MCP types and internal modules are not public APIs. Authentication is defined by the [anonymous-first policy](anonymous-first.md).

## Inputs and Results

| Tool | Required input | Optional input | Upstream mapping |
| --- | --- | --- | --- |
| `web_search` | `query: string` | `numResults: integer`, 1–20 | `web_search_exa` with the same fields |
| `web_fetch` | `url: string` | `maxCharacters: integer`, 1–20,000 | `web_fetch_exa` with `urls: [url]` and the optional limit |

Pi validates the TypeBox schemas before execution. Optional values are omitted from the MCP call when absent so Exa owns its defaults.

The client collects MCP text blocks in order, joining them with blank lines. It does not parse search results or introduce a package-owned response schema. A successful MCP response without text is an error. MCP `isError: true` is thrown as a Pi tool error, not returned as successful content.

Successful Pi results contain text plus stable `details`:

| Field                          | Meaning                                           |
| ------------------------------ | ------------------------------------------------- |
| `provider`                     | Always `exa`                                      |
| `operation`                    | `search` or `fetch`                               |
| `auth`                         | Actual successful route: `anonymous` or `api-key` |
| `query`, `requestedNumResults` | Search input and optional requested count         |
| `url`, `maxCharacters`         | Fetch input and optional requested limit          |

Only the fields for the invoked operation are present, and omitted limits remain absent. Requested counts must not be presented as actual returned counts. Details contain neither credentials nor HTTP headers nor raw protocol data.

## Pi Presentation

The standard Pi tool shell owns pending, success, and error framing. Calls show the query or URL, requested limits, and progress while executing. Collapsed results show completion and the successful authentication route; expanded results show Exa text. Display normalization removes terminal sequences and normalizes line endings without changing successful model-facing text.

Errors show a concise collapsed summary and expanded error text. Cancellation is normalized to `Cancelled`. The renderer uses arguments and result details; it does not infer metadata from Exa text or consult the authentication policy.

## Errors and Secret Handling

MCP tool errors, SDK failures, and network failures are thrown so Pi marks the call as failed. Missing credentials after an anonymous limit produce a package-owned message naming `EXA_API_KEY`, linking to the Exa key dashboard, and suggesting retry later. Cancellation and connection cleanup follow the [lifecycle contract](../architecture.md#connection-and-cancellation).

API keys, request headers, and full request objects must not appear in error messages. **Known implementation gap:** the client propagates upstream MCP error text and SDK/network exceptions, while the renderer only sanitizes terminal display. Secret-free error output is therefore not established. The [OAuth and routing proposal](../proposals/oauth-routing.md#failure-classification-and-safe-output) specifies package-owned error templates and allowlisted metadata, but that protection is not implemented. Raw error propagation is an implementation limitation, not the safety contract.

The schemas and rendering implementation are in [`src/register-tools.ts`](../../../src/register-tools.ts); text extraction is in [`src/exa-mcp-client.ts`](../../../src/exa-mcp-client.ts). See [quality criteria](../quality.md) for verification responsibilities.
