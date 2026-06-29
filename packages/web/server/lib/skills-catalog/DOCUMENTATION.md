# Skills Catalog Module Documentation

## Purpose
This module provides Codex skill discovery, scanning, and installation for git repository sources and the ClawdHub registry.

## Entrypoints and structure
- `cache.js`: in-memory scan-result cache.
- `curated-sources.js`: predefined skill sources.
- `git.js`: git command helpers and auth error detection.
- `install.js`: skill installation from git repositories.
- `scan.js`: skill scanning from git repositories.
- `source.js`: source string parsing.
- `clawdhub/`: ClawdHub registry scan/install integration.

## Public API
- `getCuratedSkillsSources()`: returns curated skill sources.
- `parseSkillRepoSource(source, { subpath })`: parses SSH, HTTPS, or `owner/repo[/subpath]` repository sources.
- `scanSkillsRepository({ source, subpath, defaultSubpath, identity })`: scans a repository for `SKILL.md` files.
- `installSkillsFromRepository(...)`: installs selected skills to user or project scope.
- `scanClawdHub()`, `scanClawdHubPage({ cursor })`, and `installSkillsFromClawdHub(...)`: ClawdHub integration.

## Installation targets
- User scope installs under the configured user skill directory.
- Project scope installs under the selected project/workspace skill directory.
- Skill names must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/`.

## Response contracts
- Scan responses return `{ ok, normalizedRepo, effectiveSubpath, items, error? }`.
- Install responses return `{ ok, installed, skipped, error? }`.
- Conflict errors include conflict details so the UI can prompt, skip, or overwrite.

## Notes for contributors
- Keep all exported functions result-object based; do not throw for expected scan/install failures.
- Preserve sparse checkout and non-interactive git behavior.
- Reject symlinks and path traversal when copying skill packages.

## Verification
- Run the targeted skills-catalog tests when changing scan/install behavior.
