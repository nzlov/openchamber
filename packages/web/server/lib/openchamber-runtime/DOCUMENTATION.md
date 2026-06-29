# OpenChamber Runtime Module Documentation

## Purpose
This module owns OpenChamber web-server features that are not part of the Codex agent protocol itself: configuration files, settings, agents, commands, MCP, snippets, plugins, project directories, PWA metadata, static routes, tunnel wiring, shutdown, and startup helpers.

Codex-native thread, turn, model, approval, MCP-status, skill-list, and config protocol calls live under `packages/web/server/lib/codex/`.

## Runtime boundaries
- Codex user data is read from `CODEX_HOME` when set, otherwise `~/.codex`.
- OpenChamber UI/session auth data is read from `OPENCHAMBER_DATA_DIR` when set, otherwise `~/.config/openchamber`.
- Project-scoped Codex config uses `codex.json`, `codex.jsonc`, `.codex/codex.json`, or `.codex/codex.jsonc`.
- Project-scoped snippets and plugins live under `.codex/snippet`, `.codex/snippets`, and `.codex/plugins`.
- This module must not start, proxy, or emulate a legacy agent server.

## Entrypoints and structure
- `routes.js`: registers OpenChamber-owned runtime/config routes.
- `feature-routes-runtime.js`: wires OpenChamber feature modules into the Express app.
- `core-routes.js`: system, auth, bootstrap, and UI-support routes.
- `config-entity-routes.js`: agents, commands, MCP, snippets, plugins, providers, and related config endpoints.
- `settings-runtime.js`, `settings-helpers.js`, `settings-normalization-runtime.js`: settings loading, migration, and normalization.
- `agents.js`, `commands.js`, `mcp.js`, `skills.js`, `snippets.js`, `plugins.js`: config-backed entity stores.
- `auth.js`: Codex auth-file read/write helpers.
- `project-directory-runtime.js`, `project-icon-routes.js`, `pwa-manifest-routes.js`, `static-routes-runtime.js`: web UI support routes.
- `env-runtime.js`, `path-utils.js`, `server-utils-runtime.js`: PATH and executable discovery helpers for the web runtime.
- `server-startup-runtime.js`, `startup-pipeline-runtime.js`, `shutdown-runtime.js`, `hmr-state-runtime.js`: server lifecycle helpers.
- `tunnel-auth.js`, `tunnel-wiring-runtime.js`: tunnel bootstrap and auth wiring.
- `session-runtime.js`: OpenChamber session status, activity, and attention snapshots.

## Public route families
- `/api/config/*`: OpenChamber-owned settings and configuration entities.
- `/api/openchamber/*`: OpenChamber runtime metadata and helper endpoints.
- `/api/project/*`, `/api/projects/*`, `/api/client-auth/*`, `/api/push/*`, and related feature routes registered by `feature-routes-runtime.js`.
- Browser UI static routes and API-only fallback routes.

## Notes for contributors
- Keep Codex protocol behavior in `packages/web/server/lib/codex/`.
- Keep OpenChamber-owned feature routes explicit; do not add a generic legacy proxy.
- Do not add compatibility paths for old config files or old environment variables.
- If a shared UI route is added here, provide VS Code parity or an explicit unsupported response.

## Verification
- Run targeted tests near the changed module.
- For broad runtime changes, run `bun run type-check:web`, `bun run lint:web`, `bun run build:web`, and a Web server `/health` smoke.
