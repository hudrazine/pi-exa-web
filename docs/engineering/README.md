# Engineering Documentation

`@hudrazine/pi-exa-web` provides Pi-native web search and page retrieval through Exa Hosted MCP. Start with [product and scope](product.md), then choose the document for the question you need to answer.

## Project State

| Area | State | Where to read |
| --- | --- | --- |
| Web tools and anonymous/API-key access | Implemented in `0.1.0` | [Tool contract](design/web-tools.md), [authentication contract](design/anonymous-first.md) |
| Safe errors and route-specific connections | PR1 merged in [#15](https://github.com/hudrazine/pi-exa-web/pull/15); unreleased | [Errors and secret handling](design/web-tools.md#errors-and-secret-handling) |
| Selectable anonymous/API-key routing | PR3 merged in [#17](https://github.com/hudrazine/pi-exa-web/pull/17); unreleased | [Delivery plan](plans/oauth-routing.md) |
| SQLite OAuth coordination, JSON storage and higher Node.js minimum | PR2 merged in [#16](https://github.com/hudrazine/pi-exa-web/pull/16); all four CI jobs passed | [Decision and rationale](decisions/sqlite-state-locking.md), [lock contract](design/oauth-state-locking.md) |
| Saved OAuth selection, refresh and private logout | PR4 merged in [#19](https://github.com/hudrazine/pi-exa-web/pull/19); all four CI jobs passed | [OAuth state design](proposals/oauth-state.md), [verification](plans/oauth-verification.md) |
| Interactive login and management commands | PR5 merged in [#20](https://github.com/hudrazine/pi-exa-web/pull/20); all four CI jobs passed; Hosted smoke pending | [Login and state](proposals/oauth-state.md#explicit-login), [verification](plans/oauth-verification.md#pr5-verification) |
| Changesets release automation | Implemented; first managed publication unverified | [Remaining release verification](plans/changesets-release-automation.md) |

“Accepted” identifies a selected design and its constraints, not implemented or verified behavior. PR1–PR5 are merged and unreleased. PR6 prepares documentation and package evidence (T12); Hosted compatibility (T13) and publication verification (T14) remain separate pending conditions. See the [ticket tracker](plans/oauth-tickets.md).

## Understand and Maintain the Package

| Reader's question | Authoritative document |
| --- | --- |
| Who is this for, what must it achieve, and what is excluded? | [Product and scope](product.md) |
| How do Pi integration, MCP connections, and authentication fit together? | [Architecture](architecture.md) |
| What inputs, results, display, and errors do users observe? | [Pi tool contract](design/web-tools.md) |
| When may calls retry or use OAuth or an API key? | [Anonymous-first authentication](design/anonymous-first.md) |
| How should changes be checked? | [Quality and development](quality.md) |
| How is a version reviewed, published, and verified? | [Release procedure](releases.md) |

User installation and usage belong in the [package README](../../README.md). [Package configuration](../../package.json) owns dependency versions, runtime requirements, and publication metadata.

## Plan and Evaluate Work

The [local ticket and PR tracker](plans/oauth-tickets.md) splits `0.2.0` into review units and records dependencies, acceptance criteria, PR links, and progress without GitHub Issues.

The [OAuth delivery plan](plans/oauth-routing.md) defines remaining stages and dependencies. Its accepted behavior is specified by the [routing and management design](proposals/oauth-routing.md) and [OAuth lifecycle and state design](proposals/oauth-state.md), retained at their existing proposal paths. The [verification specification](plans/oauth-verification.md) covers local acceptance cases, supported-runtime checks, and Hosted release conditions.

The [Changesets verification plan](plans/changesets-release-automation.md) covers the next authorized managed publication independently of OAuth work.

## Understand Decisions and Evidence

The [SQLite decision record](decisions/sqlite-state-locking.md) preserves the coordination choice, runtime tradeoff, and limits. Other design reasons appear beside the relevant implemented or accepted contract.

[Initial release verification](records/initial-release.md) preserves artifact identity, package-name migration, and completed publication checks. Historical results do not describe current registry tags or prove the accepted OAuth feature works.
