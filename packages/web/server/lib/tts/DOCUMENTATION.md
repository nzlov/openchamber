# TTS Module Documentation

## Purpose
This module provides server-side Text-to-Speech services using OpenAI-compatible audio APIs. The historical shared text summarization endpoint now lives in `packages/web/server/lib/text/` as a local fallback stub.

## Entrypoints and structure
- `index.js`: public entrypoint imported by `packages/web/server/index.js`.
- `routes.js`: route registration for `/api/voice/*`, `/api/tts/*`, and `/api/stt/*`.
- `service.js`: OpenAI-compatible TTS service implementation.
- `stt.js`: OpenAI-compatible transcription proxy.
- `base-url.js`: custom OpenAI-compatible base URL validation.
- `capability-runtime.js`: local macOS `say` capability probing.

## Public API
- `ttsService`: singleton `TTSService`.
- `TTSService`: class for OpenAI-compatible audio generation.
- `TTS_VOICES`: supported voice identifiers.
- `detectSayTtsCapability(processLike)`: probes local `say` voice support.

## API key resolution
OpenAI API keys are resolved in order:
1. `OPENAI_API_KEY`.
2. Codex auth file entries under `openai`, `codex`, or `chatgpt`.
3. A request-provided API key or custom OpenAI-compatible server URL.

## Runtime behavior
- `generateSpeechStream(options)` returns `{ buffer, contentType }` for direct client playback.
- `generateSpeechBuffer(options)` returns an MP3 buffer for cache-oriented callers.
- Custom base URLs receive the conservative speech parameter subset.
- Model-backed summarization is retired and returns local fallback text only.

## Verification
- Test environment-variable and Codex-auth API key resolution.
- Test custom base URL validation and speech generation error handling.
- Run TTS route/service tests when changing request or response contracts.
