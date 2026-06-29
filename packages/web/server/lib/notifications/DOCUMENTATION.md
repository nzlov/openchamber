# Notifications Module Documentation

## Purpose
This module owns notification preparation, push subscription state, UI visibility tracking, and notification fan-out for the web server runtime.

## Entrypoints and structure
- `index.js`: public entrypoint imported by `packages/web/server/index.js`.
- `routes.js`: push, visibility, and session status/attention endpoints.
- `push-runtime.js`: push subscription persistence, VAPID initialization, and UI visibility runtime.
- `emitter-runtime.js`: desktop/stdout and UI SSE notification emission runtime.
- `runtime.js`: debounced notification trigger routing for OpenChamber session events.
- `template-runtime.js`: notification template variables and session text/title enrichment runtime.
- `message.js`: text truncation and plain-text normalization helpers.

## Public API
- `truncateNotificationText(text, maxLength)`: truncates text to a maximum length.
- `prepareNotificationLastMessage({ message, settings })`: normalizes and truncates the final message text.
- `registerNotificationRoutes(app, dependencies)`: registers push, visibility, stream, session status, and attention endpoints.
- `createNotificationTriggerRuntime(dependencies)`: routes completion/error/question/permission triggers to native and web push notification channels.
- `createPushRuntime(dependencies)`: manages web push keys, subscriptions, and UI visibility.
- `createNotificationEmitterRuntime(dependencies)`: emits desktop notifications and UI event notifications.
- `createNotificationTemplateRuntime(dependencies)`: resolves notification templates and locally derives message text.

## Runtime behavior
- Push notifications are suppressed while a fresh focused UI heartbeat exists.
- Model-backed notification summarization is retired; text helpers return local fallback text only.
- Legacy summarization settings may still exist in persisted settings but are ignored.

## Verification
- Message helpers: `bun test packages/web/server/lib/notifications/message.test.js`
- Template helpers: `bun test packages/web/server/lib/notifications/template-runtime.test.js`
