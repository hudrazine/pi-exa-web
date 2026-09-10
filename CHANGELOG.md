# @hudrazine/pi-exa-web

## 0.2.0

### Minor Changes

- [#21](https://github.com/hudrazine/pi-exa-web/pull/21) [`001838d`](https://github.com/hudrazine/pi-exa-web/commit/001838d3d0ba0c96a0caf766f30b5a35fb5c7399) Thanks [@hudrazine](https://github.com/hudrazine)! - Add argument completion with short descriptions for `/exa` subcommands and routing strategy values in interactive Pi.

- [#16](https://github.com/hudrazine/pi-exa-web/pull/16) [`d9b84f9`](https://github.com/hudrazine/pi-exa-web/commit/d9b84f93ca9c489d8abc3df574fce9c335ae1ed9) Thanks [@hudrazine](https://github.com/hudrazine)! - Require Node.js 24.15.0 or later and add the private storage foundation for OAuth credentials and routing settings. OAuth updates use SQLite exclusion and revisioned JSON; settings use validated atomic replacement. Add `/exa strategy` to save anonymous-first or authenticated-first routing. Anonymous limits now allow one no-header probe and a fixed cooldown, while authenticated credit errors allow one anonymous fallback. Show the successful route and expanded fallback reason without changing tool text. Prefer saved OAuth credentials over API keys when authentication is needed. Refresh under the cross-process lock, reuse newer credentials after 401, and stop safely if refreshed credentials cannot be saved. Add `/exa login` in local interactive Pi with a temporary authorization screen, cancellation and validation before saving. Failed or conflicting re-login preserves existing credentials. Add `/exa status` for local state without network access and `/exa logout` to remove local OAuth credentials while retaining the strategy and API key.

### Patch Changes

- [#15](https://github.com/hudrazine/pi-exa-web/pull/15) [`bab5902`](https://github.com/hudrazine/pi-exa-web/commit/bab59026ffde2595428ac7b803abb6ee632f2b90) Thanks [@hudrazine](https://github.com/hudrazine)! - Replace raw Exa errors with safe package messages. Use separate anonymous and API-key MCP connections, including API-key initialization headers, and recover expired sessions once. Abort active HTTP requests on cancellation and close all connections under one shutdown grace period.

## 0.1.0

### Minor Changes

- Add Pi-native `web_search` and `web_fetch` tools backed by Exa Hosted MCP, using anonymous access first and `EXA_API_KEY` only after an anonymous rate limit.
