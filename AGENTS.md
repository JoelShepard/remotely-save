# AGENTS.md

This file records the project conventions and configuration for AI coding assistants.

## Project Overview

Remotely Save is an Obsidian plugin for syncing vaults with cloud services (S3-compatible, WebDAV, Webdis). It runs in the browser environment provided by Obsidian (both desktop and mobile).

## Tech Stack

- **Language**: TypeScript
- **Build**: webpack (production, `webpack.config.js`), esbuild (dev with watch, `esbuild.config.mjs` + `esbuild.injecthelper.mjs`)
- **Test**: mocha + chai
- **Formatter**: Biome (`npm run format`, config in `biome.json`)
- **Runtime**: Bun (preferred) or Node.js

### Key Dependencies

- `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` — S3 SDK
- `webdav` — WebDAV client library
- `localforage` + plugins (`localforage-getitems`, `localforage-setitems`) — IndexedDB abstraction
- `@fyears/rclone-crypt` — RClone-compatible cipher
- `p-queue` — concurrency control
- `lucide` — icon library
- `qrcode` — QR code generation
- `node-diff3` — three-way merge algorithm (used in sync engine)
- `nanoid` — unique ID generation
- `rfc4648` — Base32/Base64 encoding
- `lodash` — general utilities

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

## How to Install the Built Plugin

Copy the build artifacts into your vault's plugin directory:

```bash
cp main.js manifest.json /path/to/your/vault/.obsidian/plugins/remotely-save/
```

Then in Obsidian: **Settings → Community Plugins → Remotely Save → Enable**.

## Key Conventions

- No PRO features — this is the open-source (free) version only.
- All source code lives in `src/`.
- Tests live in `tests/` (currently 4 test files: `configPersist`, `encryptOpenSSL`, `metadataOnRemote`, `misc`).
- Documentation lives in `docs/` (~55 markdown files across 6 subdirectories).
- The plugin manifest and config are in `manifest.json` and `manifest-beta.json`.
- Version compatibility is tracked in `versions.json`.
- License: Apache 2.0 (see `LICENSE`).
- Root-level config files: `tsconfig.json`, `biome.json`, `.editorconfig`, `styles.css`, `url-shim.js`, `.env.example.txt`.
- Legal/contributing: `CLA.md`, `CONTRIBUTING.md`.
- CI/CD: `.github/workflows/` (auto-build, CLA, release).
- Branding: `assets/branding/`.

## Architecture

### Source Files (`src/`)

#### Plugin Entry Point & Core

- `src/main.ts` — plugin entry point (1228 lines). Handles plugin lifecycle, settings, ribbon icon, commands, sync scheduling.
- `src/baseTypes.ts` — shared types/interfaces for the entire plugin.
- `src/baseTypesObs.ts` — Obsidian-specific type utilities (API version constants, platform detection).

#### Filesystem Adapters (FakeFs Hierarchy)

All adapters extend the abstract `FakeFs` base class:

- `src/fsAll.ts` — abstract `FakeFs` base class defining the FS interface (67 lines).
- `src/fsLocal.ts` — local vault filesystem operations (199 lines).
- `src/fsS3.ts` — S3-compatible storage adapter.
- `src/fsWebdav.ts` — WebDAV storage adapter.
- `src/fsWebdis.ts` — Webdis (Redis HTTP gateway) adapter.
- `src/fsMock.ts` — mock FS adapter for testing (64 lines).
- `src/fsEncrypt.ts` — encryption wrapper/decorator around any `FakeFs` (587 lines).
- `src/fsGetter.ts` — factory function to select the right adapter.

#### Encryption Layer

- `src/encryptOpenSSL.ts` — OpenSSL-compatible encryption/decryption (AES-256-CBC with PBKDF2).
- `src/encryptRClone.ts` — RClone-compatible encryption/decryption (XSalsa20Poly1305, EME filename obfuscation).
- `src/encryptRClone.worker.ts` — Web Worker for non-blocking rclone crypto operations (184 lines).
- `src/fsEncrypt.ts` — (listed above) the encryption wrapper that selects between the two backends.

#### State & Persistence

- `src/localdb.ts` — IndexedDB abstraction layer via localforage (607 lines). Handles all persistent local state.
- `src/configPersist.ts` — config obfuscation/deobfuscation (67 lines).

#### Sync Engine

- `src/syncEngine.ts` — the open-source sync algorithm (911 lines). Core sync logic.
- `src/syncAlgoV3Notice.ts` — v3 sync algorithm migration notice modal (128 lines).
- `src/metadataOnRemote.ts` — remote metadata file handling (112 lines).

#### Utilities

- `src/misc.ts` — largest utility file (854 lines). Path handling, hidden file detection, time formatting, string manipulation, client-side diff3 for conflict resolution, config migration.
- `src/copyLogic.ts` — file/folder copy logic between FS backends (60 lines).
- `src/profiler.ts` — performance profiler class (153 lines).
- `src/debugMode.ts` — debug/profiler utilities (94 lines).
- `src/obsFolderLister.ts` — Obsidian folder listing utilities (141 lines).
- `src/logManager.ts` — console log interception for in-app log viewing (75 lines).

#### Internationalization

- `src/i18n.ts` — i18n engine.
- `src/langs/` — translation files (`en.json`, `zh_cn.json`, `zh_tw.json`, `index.ts`, `LICENSE`, `README.md`).

#### Settings UI (`src/settings/`)

- `index.ts` — main settings tab (103 lines).
- `helpers.ts` — UI helper functions.
- `modals.ts` — settings modal dialogs.
- `sections/` — 8 section files: `basic.ts`, `advanced.ts`, `s3.ts`, `webdav.ts`, `webdis.ts`, `importExport.ts`, `debug.ts`, `logs.ts`.

#### Type Declarations

- `src/worker.d.ts` — Webpack worker module type declaration (6 lines).

#### Other Files in `src/`

- `README.md`, `LICENSE` — documentation and license within src.

### Root-level Config & Build Files

- `webpack.config.js` — webpack production build config (117 lines).
- `esbuild.config.mjs` — esbuild dev build config (89 lines).
- `esbuild.injecthelper.mjs` — Buffer/process injection helper for browser (2 lines).
- `tsconfig.json` — TypeScript compiler config (20 lines).
- `biome.json` — Biome formatter/linter config (55 lines).
- `url-shim.js` — URL polyfill for `fileURLToPath` in browser (11 lines).
- `styles.css` — plugin stylesheet (76 lines).

### Largest Source Files (by line count)

| File | Lines | % of src/ |
|------|-------|-----------|
| `main.ts` | 1228 | ~23% |
| `syncEngine.ts` | 911 | ~17% |
| `misc.ts` | 854 | ~16% |
| `localdb.ts` | 607 | ~11% |
| `fsEncrypt.ts` | 587 | ~11% |

These 5 files account for ~78% of the code in `src/`.

## Guidelines for AI Agents

- Do NOT add comments to source code unless asked.
- Follow existing code style (TypeScript, lodash, lucide icons).
- Test with `npm run test` before committing.
- Format with `npm run format` before committing.
- Do NOT commit unless explicitly asked.
- `misc.ts` should not depend on any other written code (it's the lowest-level utility module).
- Each storage adapter should not depend on `syncEngine.ts`.
- Folders are always represented by a string ending with `/`.
- No PRO features — only work on the open-source (free) version.
