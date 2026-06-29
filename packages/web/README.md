# @openchamber/web

OpenChamber Web is the browser/PWA runtime for the Codex-backed OpenChamber experience. It serves the shared UI, local API routes, Codex runtime endpoints, notifications, terminal support, filesystem helpers, tunnels, and remote-client linking.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/btriapitsyn/openchamber/main/scripts/install.sh | bash
```

Or install manually:

```bash
bun add -g @openchamber/web
```

Prerequisites: Node.js 22+ and a `codex` CLI available on `PATH`. To use a custom binary path, set `OPENCHAMBER_CODEX_BINARY`.

## Usage

```bash
openchamber                          # Start on port 3000
openchamber --port 8080              # Custom port
openchamber --lan --port 3000        # Listen on LAN (0.0.0.0)
openchamber --ui-password secret     # Password-protect UI
openchamber startup enable           # Start at login as a native service
OPENCHAMBER_UI_PASSWORD=secret openchamber startup enable
openchamber startup status
openchamber startup disable
openchamber tunnel help
openchamber tunnel providers
openchamber tunnel start --provider cloudflare --mode quick --qr
openchamber connect-url --port 3000
openchamber connect-url --server http://host:3000 --qr
openchamber logs
openchamber stop
openchamber update
```

`startup enable` snapshots your current environment into the native service so startup behaves like you launched `openchamber` from the same shell. This preserves provider tokens, PATH, SSH agent settings, Codex binary overrides, and other CLI auth/config env vars. Use `--no-env-snapshot` for a minimal service env.

## Environment

| Variable | Description |
|---|---|
| `OPENCHAMBER_CODEX_BINARY` | Absolute path to the Codex CLI binary. Falls back to `CODEX_BINARY`, then `codex` on `PATH`. |
| `CODEX_BINARY` | Secondary Codex CLI binary override. |
| `OPENCHAMBER_HOST` | Bind hostname for the OpenChamber web server. Default: `127.0.0.1`. |
| `OPENCHAMBER_UI_PASSWORD` | Password-protect browser access. Required for unauthenticated LAN exposure unless explicitly overridden. |
| `OPENCHAMBER_API_ONLY` | Set to `true` to run API routes without serving browser UI assets. |
| `OPENCHAMBER_VERBOSE_REQUEST_LOGS` | Set to `true` to log every HTTP request. |
| `OPENCHAMBER_SKIP_API_COMPRESSION` | Set to `true` to disable gzip compression for `/api/*` responses. |
| `OPENCHAMBER_COMPRESS_API` | Set to `true` to force `/api/*` compression, or `false` to disable it. |

## Tunnels

One active tunnel can be attached to a running OpenChamber instance. Starting a different tunnel mode or provider on the same instance replaces the active tunnel. Connect links are one-time tokens; generating a new link revokes the previous unused link.

```bash
openchamber tunnel profile add --provider cloudflare --mode managed-remote --name prod-main --hostname app.example.com --token <token>
openchamber tunnel start --profile prod-main
openchamber tunnel start --provider cloudflare --mode managed-local --config ~/.cloudflared/config.yml
openchamber tunnel status --all
openchamber tunnel stop --port 3000
```

## Remote Clients

Use `connect-url` when a web/API server should be added to OpenChamber Desktop or another OpenChamber app.

```bash
openchamber connect-url --port 3000
openchamber connect-url --port 3000 --qr
openchamber connect-url --port 3000 --json
openchamber connect-url --port 3000 --name "Workstation"
openchamber connect-url --port 3000 --lan --server http://workstation.local:3000 --qr
```

For a remote machine that only exposes APIs:

```bash
openchamber connect-url --port 3000 --api-only --lan --server http://workstation.local:3000 --qr --ui-password your-password
```

`--api-only` starts API routes without serving browser UI assets. `--lan` binds the server so other machines can reach it. `--server` is the address saved into the connection link. `--ui-password` protects browser access if UI routes are enabled elsewhere; the generated client token is what another OpenChamber app uses for API access.

## Data Directory

Mount `data/` for persistent storage in container deployments. Ensure permissions:

```bash
mkdir -p data/openchamber data/ssh
chown -R 1000:1000 data/
```

## Web Features

- Remote access through Cloudflare tunnel and QR onboarding.
- Mobile-first PWA layouts for chat, settings, files, and attachment flows.
- Background notifications and cross-tab session activity tracking.
- Built-in update and restart flow that keeps server settings intact.

## License

MIT
