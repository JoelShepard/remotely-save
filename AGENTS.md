# AGENTS.md

This file records the project conventions and configuration for AI coding assistants.

## Project Overview

Remote Sync is a fork of Remotely Save, an Obsidian plugin for syncing vaults with cloud services (S3-compatible, WebDAV). It runs in the browser environment provided by Obsidian (both desktop and mobile).

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
cp main.js manifest.json /path/to/your/vault/.obsidian/plugins/remote-sync/
```

Then in Obsidian: **Settings → Community Plugins → Remote Sync → Enable**.

## Key Conventions

- No PRO features — this is the open-source (free) version only.
- All source code lives in `src/`.
- Tests live in `tests/` (currently 5 test files: `configPersist`, `encryptOpenSSL`, `fsEncrypt`, `metadataOnRemote`, `misc`).
- Documentation lives in `docs/` (~55 markdown files across 6 subdirectories).
- The plugin manifest and config are in `manifest.json` and `manifest-beta.json`.
- Version compatibility is tracked in `versions.json`.
- Git tags follow the `X.Y.Z` format (no leading `v`), e.g., `0.7.0`.
- License: Apache 2.0 (see `LICENSE`).
- Root-level config files: `tsconfig.json`, `biome.json`, `.editorconfig`, `styles.css`, `url-shim.js`, `.env.example.txt`.
- Legal/contributing: `CLA.md`, `CONTRIBUTING.md`.
- CI/CD: `.github/workflows/` (auto-build, CLA, release).
- Branding: `assets/branding/`.
- Agent skills: `.agents/skills/` contains workflow definitions (SKILL.md) for `remote-sync-maintenance`, `remote-sync-publish`, `remote-sync-test-sync`, `remote-sync-create-tests`.

## Implemented Features (2026-05-20)

### Settings Dashboard (`docs/PDR-settings-dashboard.md`) ✅
- **Dynamic service sections** — only the active S3 or WebDAV config is shown, not both
- **Inline validation** — S3 fields (endpoint URL, bucket name format, access key length, region format) and WebDAV URL are validated on input with green/red visual feedback
- **Collapsible groups** — each setting section has a clickable heading with a chevron toggle; collapsed state is persisted in `settings.collapsedGroups`
- **Password confirmation** — a "Confirm password" field prevents accidental lockout from password typos
- **Enhanced connection test** — the existing Check Connectivity button now opens a detailed modal with latency, error details, and troubleshooting suggestions
- **Mobile-responsive CSS** — service cards stack vertically, inputs go full-width, log viewer toolbar adapts on narrow screens

### Better Debugging (`docs/PDR-better-debugging.md`) ✅
- In-app log viewer modal (`src/logViewerModal.ts`)
- Structured sync trace (`src/syncTracer.ts`)
- Error categorization & history in IndexedDB
- Phase-based live sync progress in status bar
- Persistent log storage (localStorage, cross-session)
- Troubleshooting section always visible, dev options togglable inside

### S3 Sync Optimization (`docs/PDR-s3-sync-optimization.md`) ✅ Phases 1-2
- **ETag-based comparison** in `entityEquals()` — avoids unnecessary transfers when ETags match
- **Profile-agnostic prevSync fallback** (`getPrevSyncRecordsByVaultAnyProfile` in `localdb.ts`) — unblocks backend switching
- **`rmBatch()`** — S3 batch delete via `DeleteObjectsCommand` (up to 1000 keys/request) with fallback to individual deletes
- **First-sync detection** — auto-bypasses `protectModifyPercentage` when syncing to empty remote for the first time
- Pending: server-side copy, manifest-based mtime cache

### Native S3 Multi-Device Sync (`docs/PDR-s3-native-manifest-sync.md`) ✅ *Completed 2026-05-20*
- **Remote manifest on S3** — a JSON manifest at `_rs_state/<vaultID>/manifest.json` stores the sync state (ETags, mtimes, sizes) for all tracked files, acting as a shared prevSync across devices
- **Multi-device coordination** — all devices share one manifest on S3; when a new device syncs, it reads the manifest instead of starting from scratch; IndexedDB loss no longer forces a full resync
- **Manifest-based walk elimination** — `walkFromManifest()` does a bounded scan (1 ListObjectsV2 with MaxKeys=1000) and compares ETags with the manifest; if all match, remote entities are built from the manifest (skipping full paginated list)
- **Transparent fallback** — if the manifest is missing, stale (count/ETags mismatch), or the scan is truncated, the engine falls back to the full walk automatically
- **Auto-write after sync** — after each successful sync, the manifest is updated with the latest remote state

### Sync Behavior Rework (`docs/PDR-sync-behavior-rework.md`) ✅ Phases 1-3
- **Vault events → pending ops journal** — create/modify/delete/rename events wired via Obsidian's `vault.on()` API
- **Pending op deduplication** — full merge matrix (create+modify→create, create+delete→noop, etc.)
- **Debounced sync-on-save** — `triggerDebouncedSyncOnSave()` with configurable delay
- **Incremental sync path** — `processPendingOps()` processes only changed files; `incrementalSkipLocal` flag skips the full local walk
- **Remote change detection** — `RemoteSnapshot` stored after each full sync; lightweight `checkRemoteChanges()` on S3/WebDAV
- **Checkpoint system** — `SyncCheckpoint` interface; interrupted sync recovery with stale checkpoint cleanup
- Fallback to full sync when journal exceeds threshold (5000 entries)
- Pending: Unified SyncState table, conflict base version, sync history viewer

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
- `src/metadataOnRemote.ts` — remote metadata file handling (file removed, functionality refactored into other modules).

#### Utilities

- `src/misc.ts` — largest utility file (854 lines). Path handling, hidden file detection, time formatting, string manipulation, client-side diff3 for conflict resolution, config migration.
- `src/copyLogic.ts` — file/folder copy logic between FS backends (60 lines).
- `src/profiler.ts` — performance profiler class (153 lines).
- `src/debugMode.ts` — debug/profiler utilities (94 lines).
- `src/obsFolderLister.ts` — Obsidian folder listing utilities (141 lines).
- `src/logManager.ts` — console log interception for in-app log viewing now with persistent storage (localStorage) and 5000-entry ring buffer.
- `src/logViewerModal.ts` — in-app log viewer modal with filtering, live refresh, export, and capture controls (PRD better debugging).
- `src/syncTracer.ts` — structured sync trace collector recording every operation during a sync cycle with timing (PRD better debugging).

#### Internationalization

- `src/i18n.ts` — i18n engine.
- `src/langs/` — translation files (`en.json`, `zh_cn.json`, `zh_tw.json`, `index.ts`, `LICENSE`, `README.md`).

#### Settings UI (`src/settings/`)

- `index.ts` — main settings tab (103 lines).
- `helpers.ts` — UI helper functions.
- `modals.ts` — settings modal dialogs.
- `sections/` — 6 section files: `advanced.ts`, `debug.ts` (always-visible Troubleshooting section with dev toggle inside), `encryption.ts`, `importExport.ts`, `s3.ts`, `webdav.ts`.

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
| `main.ts` | ~1331 | ~22% |
| `syncEngine.ts` | ~1240 | ~20% |
| `misc.ts` | 854 | ~14% |
| `localdb.ts` | ~1060 | ~17% |
| `fsWebdav.ts` | ~1015 | ~16% |
| `fsS3.ts` | ~877 | ~14% |
| `fsEncrypt.ts` | ~645 | ~10% |

These 7 files account for ~83% of the code in `src/`.

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

## Development Workflow

Follow this sequence when implementing new features:

```
TODO → PRD → Implementation ⇄ Test (loop) → sync to testvault → mark as completed
```

1. **TODO** — Identify a need or feature gap. Add it to `TODO.md` as a checkbox item.
2. **PRD** — Write a Product Definition Requirement in `docs/PDR-<slug>.md` covering:
   - Current state & pain points
   - Proposed solution(s) with estimated effort and risk
   - Implementation roadmap (phases with tasks)
   - Success metrics
3. **Implementation** — Build the feature. Follow code conventions (no comments, match existing style).
4. **Test (loop)** — Run `npm run test`. If tests fail, fix and repeat. If new functionality needs testing, add tests to `tests/`.
5. **sync to testvault** — Once tests pass, build (`npm run build`) and copy artifacts to the test vault:
   ```bash
   cp main.js manifest.json styles.css ~/Documenti/TestVault/.obsidian/plugins/remote-sync/
   ```
6. **mark as completed** — Update `TODO.md`:
   - Mark the checkbox `[x]`
   - Append `✅ *Completed YYYY-MM-DD*`
   - List key deliverables

After marking as completed, update this `AGENTS.md` and `TODO.md` to reflect the new state.

> **Note**: If the task is small and doesn't warrant a full PRD, skip step 2 and go straight from TODO to Implementation.
