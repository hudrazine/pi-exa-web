# Repository Guidance

Guidance for AI coding agents working in this repository.

## Project Overview

`pi-exa-web` is a Pi Package that provides Pi-native `web_search` and `web_fetch` tools through Exa Hosted MCP, using anonymous access first and `EXA_API_KEY` only after an anonymous rate limit. See [the engineering documentation](docs/engineering/index.md) for the accepted design, active plans, and implementation history.

## Commands

This repository uses Vite+, a unified toolchain for runtime and package management, development, builds, tests, formatting, linting, and type checking through the global `vp` CLI. Use `vp <command>` for built-in commands and `vp run <name>` for scripts defined in `package.json` or tasks in `vite.config.ts`. Documentation is available locally at `node_modules/vite-plus/docs` and online at https://viteplus.dev/guide/.

- `vp install`: Install dependencies
- `vp run check`: Check formatting, linting, and types (`--fix` applies auto-fixes)
- `vp run test`: Run tests

Pi loads the TypeScript Extension source through jiti, so this package has no build step or generated distribution artifact.

## Git

- Format commit messages as Conventional Commits.
- Keep commit messages concise and searchable.
- Include the reason for a change in the commit body when useful.

## Issues and Pull Requests

- Format PR titles like commit messages so they are suitable for final squash commit titles.
- Keep issues and pull requests concise and searchable.
- Briefly summarize the main changes in PR descriptions and include the reason when useful.
- Add issue references, test notes, and breaking-change notes only when relevant.

## Documentation sources

When using Context7 `query-docs`, use:

- Pi: `/websites/pi_dev` or `/earendil-works/pi`
- MCP TypeScript SDK: `/modelcontextprotocol/typescript-sdk`
