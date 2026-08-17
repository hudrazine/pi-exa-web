# Repository Guidance

Guidance for AI coding agents working in this repository.

## Commands

This project uses Vite+, a unified toolchain with the global CLI `vp` (distinct from Vite; use `vp dev` / `vp build`). `vp <name>` runs a built-in; `vp run <name>` runs a `package.json` script or `vite.config.ts` task—scripts cannot overwrite built-ins, so check those files first. Docs: `node_modules/vite-plus/docs` or https://viteplus.dev/guide/.

- `vp help` / `vp <command> --help`: list commands and show command help
- `vp install`: after pulling remote changes and before starting work
- `vp run check`: format, lint, and typecheck changes (`--fix` applies auto-fixes)
- `vp run test`: test code
- `vp run build`: build code
- `vp run <script>`: run other project scripts or Vite Task entries needed for validation
- `vp env doctor`: when setup, runtime, or package-manager behavior looks wrong; include its output when asking for help

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
