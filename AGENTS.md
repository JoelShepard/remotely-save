# AGENTS.md

This file records the project conventions and configuration for AI coding assistants.

## Project Overview

Remotely Save is an Obsidian plugin for syncing vaults with cloud services (S3-compatible, Dropbox, OneDrive, WebDAV, Webdis). It runs in the browser environment provided by Obsidian (both desktop and mobile).

## Tech Stack

- **Language**: TypeScript
- **Build**: webpack (production), esbuild (dev with watch)
- **Test**: mocha + chai
- **Formatter**: Biome (`npm run format`)
- **Runtime**: Bun (preferred) or Node.js

## Commands

```bash
npm run build       # webpack production build
npm run dev         # webpack dev with watch
npm run build2      # esbuild production build (tsc + esbuild)
npm run dev2        # esbuild dev with watch
npm run test        # mocha tests
npm run format      # biome format check + write
npm run clean       # remove main.js
```

## Key Conventions

- No PRO features — this is the open-source (free) version only.
- All source code lives in `src/`.
- Tests live in `tests/`.
- Documentation lives in `docs/`.
- The plugin manifest and config are in `manifest.json` and `manifest-beta.json`.
- License: Apache 2.0 (see `LICENSE`).

## Architecture

- `src/main.ts` — plugin entry point
- `src/settings.ts` — settings tab (~2700 lines)
- `src/baseTypes.ts` — shared types
- `src/fs*.ts` — filesystem adapters for each service
- `src/fsEncrypt.ts` — encryption layer
- `src/fsLocal.ts` — local filesystem operations
- `src/fsGetter.ts` — factory for selecting the right adapter
- `src/configPersist.ts` — config persistence
- `src/importExport.ts` — QR code import/export
- `src/langs/` — i18n
- `src/debugMode.ts` — debug/profiler utilities

## Guidelines for AI Agents

- Do NOT add comments to source code unless asked.
- Follow existing code style (TypeScript, lodash, lucide icons).
- Test with `npm run test` before committing.
- Format with `npm run format` before committing.
- Do NOT commit unless explicitly asked.
