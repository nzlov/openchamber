# Event Stream Module Documentation

## Purpose
This module owns OpenChamber UI event fan-out helpers for the web server runtime.

## Entrypoints and structure
- `index.js`: public entrypoint.
- `runtime.js`: `createGlobalUiEventBroadcaster`.

## Public API
- `createGlobalUiEventBroadcaster({ sseClients, wsClients, writeSseEvent })`: fans out synthetic OpenChamber events to connected SSE and WebSocket clients.

## Runtime behavior
- SSE clients receive events through the injected `writeSseEvent` helper.
- WebSocket clients receive JSON-stringified event payloads when their socket is open.
- Broken clients are removed from their owning client set.

## Notes for contributors
- Keep this module transport-only. Agent runtime event production belongs to the Codex runtime module.
- Do not add long-lived event history here; this helper only broadcasts current events to current clients.

## Verification
- Run the tests that cover callers of `createGlobalUiEventBroadcaster`.
