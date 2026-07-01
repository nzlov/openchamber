---
name: online-runtime-debug
description: Use when debugging OpenChamber behavior on a live or remote deployment with a headless browser, UI password auth, protected runtime APIs, session/thread ids, screenshots, DOM inspection, or production-only rendering discrepancies. Use for tasks like checking whether a live duplicate message, auth-gated API response, route selection issue, or rendered UI state comes from backend data, frontend projection, or deployed assets.
---

## Scope

Use this skill for live OpenChamber debugging where the browser UI and authenticated runtime API must be inspected together.

Do not use it for local-only unit tests, normal feature implementation, or unauthenticated static page checks.

## Security Rules

- Never write UI passwords, bearer tokens, cookies, client tokens, or session secrets into repo files, skill files, shell history, command arguments, screenshots, final answers, or persistent logs.
- Prefer reading secrets from interactive stdin, `getpass`, or a one-shot environment variable scoped to the command. Do not put secrets directly in `cmd`.
- Store temporary debug artifacts only under `/tmp`, and redact or delete sensitive artifacts before finalizing.
- Do not read browser profile cookies or password stores unless the user explicitly authorizes that exact action.
- Do not mutate live data while diagnosing unless the user asks for a write operation. Use `GET` endpoints and page inspection first.
- When reporting results, cite status codes, endpoint names, message ids, hashes/lengths, and structural facts. Avoid copying long private conversation text.

## Workflow

1. Confirm the live target and identifier:
   - Base URL, for example `https://<host>`.
   - Thread/session id.
   - Optional directory/cwd hint. For OpenChamber routes, prefer `/?session=<threadId>&directory=<encoded cwd>` when cwd is known.

2. Inspect auth behavior before using the browser:
   - `GET /api/...` returning plain `Authentication required` means UI password session or bearer client auth is required.
   - UI password login is `POST /auth/session` with JSON `{ password, trustDevice, issueClientToken }`.
   - Browser-context `fetch(..., { credentials: 'include' })` should be used after login so cookies remain in the same context.

3. Use a fresh headless browser context:
   - Avoid persistent user profiles.
   - Set a deterministic viewport large enough to capture the relevant UI.
   - Attach console and page-error listeners, but redact output before storing or reporting.
   - If pressing Enter in the password input does not submit, perform the same `/auth/session` POST from page context.

4. Open the target route and wait for evidence:
   - Navigate to the target session route.
   - Wait for `[data-message-id]` or a known visible text fragment.
   - If direct routing lands on the wrong workspace, include the encoded `directory` from `thread.cwd` returned by `/api/codex/threads/:threadId?includeTurns=true`.

5. Capture backend truth and UI projection in the same authenticated page context:
   - `GET /api/codex/threads/:threadId?includeTurns=true`
   - `GET /api/codex/threads/:threadId/turns?limit=20&sortDirection=asc&itemsView=full`
   - `GET /api/codex/threads/:threadId/turns?limit=20&sortDirection=desc&itemsView=full`
   - DOM: collect `[data-message-id]`, `[data-turn-id]`, visible text starts, and message counts.

6. Decide the fault boundary:
   - If the API has duplicate durable assistant/user items, suspect Codex history or backend storage/projection.
   - If the API has one item but DOM has two messages with different ids, suspect frontend sync/projection/reconciliation.
   - If direct route fails until `directory` is included, suspect route/workspace selection rather than message storage.
   - If API and DOM both look correct but screenshot differs, inspect deployed assets, hydration timing, scroll/virtualization, and CSS state.

## Useful Evidence Shape

For duplicate-message bugs, capture this minimum evidence:

```json
{
  "threadId": "<thread>",
  "apiStatuses": {
    "thread": 200,
    "turnsAsc": 200,
    "turnsDesc": 200
  },
  "lastApiItems": [
    { "id": "item-15", "roleOrType": "agentMessage", "textLen": 998, "textStart": "..." }
  ],
  "lastVisibleMessages": [
    { "id": "<session>:<turn>:000001:item-15", "textStart": "..." },
    { "id": "<session>:<turn>:000000:msg_tmp", "textStart": "..." }
  ]
}
```

Use text length, text start, and ids to prove duplication without storing full private content.

## OpenChamber-Specific Checks

- Protected runtime HTTP calls should use browser-context credentials after `/auth/session`.
- Session route parameter is `session`; the directory route parameter is `directory`.
- Chat rows expose `data-message-id`; turn groups expose `data-turn-id`.
- Codex turn history endpoints live under `/api/codex/threads/:threadId`.
- A durable turn item id like `item-15` and a live id like `msg_*` rendering the same text usually indicates frontend reconciliation, not backend duplicate storage.

## Before Editing Code

- Reproduce with API plus DOM evidence.
- Identify whether the smallest fix belongs in runtime event translation, sync reducer, materialization, route selection, or backend projection.
- Add a regression test that models the observed ids and event order. Include an out-of-order event case if live SSE ordering could vary.
- Keep live debugging artifacts out of the diff.
