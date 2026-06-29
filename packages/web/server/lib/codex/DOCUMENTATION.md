# Codex Module Documentation

## Purpose

This module owns the OpenChamber web-server integration with Codex. It is the agent runtime boundary, but it does not own OpenChamber features such as filesystem, git, terminal, tunnels, TTS, notifications, project icons, or UI authentication.

## Entrypoints and structure

- `process-runtime.js`: Codex app-server process lifecycle state, binary resolution, spawn/stop behavior, and health snapshots.
- `rpc-client.js`: newline-delimited JSON-RPC client for Codex app-server stdio transport.
- `protocol-runtime.js`: narrow JavaScript wrappers for the Codex app-server JSON-RPC methods OpenChamber consumes.
- `routes.js`: browser-facing OpenChamber-owned Codex HTTP routes.
- `generated/`: TypeScript protocol artifacts generated from the local Codex CLI. These are contract/reference artifacts, not server runtime imports.
- `schema/`: JSON Schema artifacts generated from the local Codex CLI for runtime validation work in later phases.

## Protocol source

Generated artifacts in this branch were produced with:

```bash
codex --version
codex app-server generate-ts --experimental --out packages/web/server/lib/codex/generated
codex app-server generate-json-schema --experimental --out packages/web/server/lib/codex/schema
```

The local Codex version used for this first skeleton is `codex-cli 0.142.3`.

## Current public exports

### `process-runtime.js`

- `createCodexProcessRuntime(dependencies)`: creates a managed Codex app-server process runtime.
- `resolveCodexBinary(processLike)`: resolves the configured Codex binary from `OPENCHAMBER_CODEX_BINARY`, `CODEX_BINARY`, or `codex`.

Returned runtime:

- `start(options?)`
- `initialize(options?)`
- `startAndInitialize(options?)`
- `restart(options?)`
- `stop(options?)`
- `dispose()`
- `getProtocolRuntime()`
- `getHealthSnapshot()`

`initialized` is true only after the `initialize` JSON-RPC request succeeds. Exit, spawn errors, explicit stop, and initialize failure clear initialized state and negotiated metadata.

### `rpc-client.js`

- `createCodexRpcClient(dependencies)`: creates a JSON-RPC client over readable/writable streams.

Returned client:

- `request(method, params?, options?)`
- `notify(method, params?)`
- `onNotification(handler)`
- `onServerRequest(handler)`
- `close(error?)`

### `protocol-runtime.js`

- `createCodexProtocolRuntime(dependencies)`: creates a narrow method wrapper over the JSON-RPC client.

Returned runtime:

- `initialize(options?)`
- `startThread(params, options?)`
- `resumeThread(params, options?)`
- `forkThread(params, options?)`
- `archiveThread(params, options?)`
- `unarchiveThread(params, options?)`
- `deleteThread(params, options?)`
- `listThreads(params?, options?)`
- `readThread(params, options?)`
- `listThreadTurns(params, options?)`
- `listThreadTurnItems(params, options?)`
- `setThreadName(params, options?)`
- `startTurn(params, options?)`
- `shellSession(params, options?)`
- `rollbackThread(params, options?)`
- `compactThread(params, options?)`
- `steerTurn(params, options?)`
- `interruptTurn(params, options?)`
- `listModels(params?, options?)`
- `readConfig(params?, options?)`
- `readAccount(params?, options?)`
- `loginAccount(params, options?)`
- `cancelAccountLogin(params, options?)`
- `logoutAccount(params?, options?)`
- `getAuthStatus(params?, options?)`

### `routes.js`

- `registerCodexRoutes(app, dependencies)`: registers OpenChamber-owned `/api/codex/*` routes.

Currently registered routes:

- `GET /api/codex/health`
- `GET /api/codex/capabilities`
- `POST /api/codex/restart`
- `GET /api/codex/account`
- `POST /api/codex/account/login`
- `POST /api/codex/account/login/cancel`
- `POST /api/codex/account/logout`
- `GET /api/codex/auth/status`
- `GET /api/codex/threads`
- `POST /api/codex/threads`
- `GET /api/codex/threads/:threadId`
- `POST /api/codex/threads/:threadId/fork`
- `POST /api/codex/threads/:threadId/archive`
- `POST /api/codex/threads/:threadId/unarchive`
- `DELETE /api/codex/threads/:threadId`
- `POST /api/codex/threads/:threadId/turns`
- `POST /api/codex/threads/:threadId/shell`
- `POST /api/codex/threads/:threadId/rollback`
- `POST /api/codex/threads/:threadId/compact`
- `POST /api/codex/threads/:threadId/turns/:turnId/interrupt`

## Route contract

`GET /api/codex/health` returns a deterministic status payload and does not start Codex as a side effect. It reports initialized state and negotiated Codex metadata when another explicit path has already started and initialized the managed app-server.

Thread, turn, shell, rollback, compact, and account routes initialize the managed Codex app-server on demand, then call Codex-native JSON-RPC methods through `protocol-runtime.js`. These routes reject unsupported request fields instead of translating them into compatibility glue.

## Verification

Targeted tests:

- `packages/web/server/lib/codex/process-runtime.test.js`
- `packages/web/server/lib/codex/rpc-client.test.js`
- `packages/web/server/lib/codex/protocol-runtime.test.js`
- `packages/web/server/lib/codex/routes.test.js`
