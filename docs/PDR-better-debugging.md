# PDR — Better Debugging for Remote Sync

> **Product Definition Requirement**
> Date: 2026-05-20
> Status: Draft
> Author: AI-assisted analysis

---

## 1. Executive Summary

The plugin's current debugging infrastructure is fragmented and requires manual, multi-step workflows to extract useful diagnostic information. Users experiencing sync issues have no way to inspect real-time sync behavior, view structured logs, or share actionable debug data without developer intervention. This PRD proposes a cohesive debugging layer that turns the plugin from a black box into a transparent, self-diagnosing system.

---

## 2. Current State Analysis

### Existing Debugging Infrastructure

| Component | Location | What it does | Limitations |
|-----------|----------|-------------|-------------|
| `logManager.ts` | In-memory circular buffer (2000 entries) | Intercepts `console.debug/info/warn/error` and stores them | No persistence across sessions; manual start/stop; no filtering UI in settings |
| `profiler.ts` | `Profiler` class with breakpoints | Measures elapsed time between labeled points during sync | Must be enabled before sync; results exported to files, not visualized; no real-time view |
| `debugMode.ts` | Exports sync plans & profiler results to vault files | Exports JSON snapshots of sync decisions | One-shot export only; no timeline/history browser |
| `settings/sections/debug.ts` | Developer-only settings section | Log level dropdown, export buttons, DB reset buttons | Hidden behind `showDeveloperOptions` flag; no visual log viewer |
| `how_to_debug/` docs | Markdown instructions | Tells users how to access console/vConsole/Logstravaganza | External tools only; no in-app debugging capability |

### Key Pain Points

1. **No in-app log viewer** — Users must use `Obsidian vConsole` (mobile) or browser DevTools (desktop) to see logs. The intercepted logs in `logManager.ts` exist but have no UI.
2. **Profiler is all-or-nothing** — Must be enabled before a sync runs. Cannot retroactively profile a problematic sync.
3. **Sync plans are static snapshots** — Exported as JSON files that require manual inspection. No diff view, no timeline, no visual comparison.
4. **Debug settings are hidden** — `showDeveloperOptions` defaults to `false`. Users who need debugging tools don't know where to look.
5. **No crash/error reporting** — When a sync fails, the error is logged to console and shown as a `Notice` (which auto-dismisses). No structured error capture.
6. **No performance timeline** — The profiler produces text output. No waterfall chart or timeline visualization.
7. **No remote operation tracing** — When a sync is slow, there's no way to see which S3/WebDAV API calls took the longest.

---

## 3. Proposed Solutions

### 3.1 Solution A — In-App Log Viewer

**Goal:** Provide a live, filterable log viewer within the plugin settings, so users can inspect logs without external tools.

**Implementation:**

1. **Log viewer modal** — Add a new modal (triggered from a ribbon icon or settings button) that displays log entries in real-time:
   - Color-coded by level (debug=gray, info=blue, warn=yellow, error=red)
   - Search/filter by text or log level
   - Auto-scroll to latest (with a pause button)
   - Timestamp display (relative or absolute)

2. **Persistent log storage** — Change `logManager.ts` to optionally persist logs to IndexedDB (via `localdb.ts`):
   - Add a `logTbl` in `localdb.ts` with keyed entries by `{vaultRandomID}\t{timestamp}`
   - Retention policy: keep last 7 days or 10,000 entries, whichever is smaller
   - Add a "Clear logs" button in the log viewer

3. **Log export** — Add "Export logs" button that outputs a `.md` file with all captured logs, similar to `exportVaultSyncPlansToFiles`.

4. **Config changes**:
   - Remove `logToDB` from advanced settings (make it always-on with a retention cap)
   - Add a `Logs` button in the ribbon (optional, configurable)

**Estimated effort:** 4–6 hours
**Risk:** Low

### 3.2 Solution B — Structured Sync Trace

**Goal:** Replace the profiler's ad-hoc breakpoint system with a structured trace that records every operation during a sync cycle, including API calls, durations, and results.

**Implementation:**

1. **Operation trace format** — Define a `SyncOp` interface:

```typescript
interface SyncOp {
  timestamp: number;
  type: "api_call" | "file_read" | "file_write" | "file_delete" | "decision" | "walk" | "compare";
  label: string;
  durationMs: number;
  key?: string;
  size?: number;
  error?: string;
  apiName?: string; // e.g., "ListObjectsV2", "PutObject", "DeleteObject"
}
```

2. **Trace collector** — Create a `SyncTracer` class that wraps the sync engine:

```typescript
class SyncTracer {
  private ops: SyncOp[] = [];
  private currentSyncId: string;

  beginSync(): string { /* generate syncId, record start */ }
  recordOp(op: Omit<SyncOp, "timestamp">): void { /* push with Date.now() */ }
  endSync(): SyncTraceResult { /* compute totals, return summary */ }
  getWaterfall(): string { /* return formatted text or Mermaid chart */ }
}
```

3. **Integration points**:
   - In `FakeFsS3` / `FakeFsWebdav`, inject tracing calls around every API method
   - In `syncer()` in `syncEngine.ts`, trace the three main phases: walk, compare, apply
   - In `doActualSync()`, trace file transfers and deletions

4. **Visualization**:
   - Add a "Sync Trace" button in the debug section that opens a modal with a waterfall view
   - Show a table: Operation | File | Duration | Status
   - Optionally render a Mermaid Gantt chart in the exported markdown

5. **Auto-capture on error** — When a sync fails, automatically save the trace to IndexedDB with the failed sync timestamp, so the user can inspect it even if they didn't enable tracing beforehand.

**Estimated effort:** 6–8 hours
**Risk:** Medium — tracing adds overhead; must be optional or lightweight by default.

### 3.3 Solution C — Visual Error Dashboard

**Goal:** Replace the single-line `Notice` on failure with a rich error summary that guides the user to resolution.

**Implementation:**

1. **Error severity classification** — Categorize sync errors:

| Category | Examples | Color |
|----------|----------|-------|
| `config` | Missing bucket, wrong endpoint, bad credentials | Red |
| `network` | Timeout, connection refused, DNS failure | Orange |
| `auth` | Expired token, invalid signature, 403 | Orange |
| `conflict` | File changed during sync, lock contention | Yellow |
| `internal` | Unexpected exception, IndexedDB failure | Red |
| `skip` | File too large, hidden path excluded | Gray |

2. **Error details modal** — When a sync fails, instead of a brief notice, show a modal with:
   - Error summary (count by category)
   - First N errors with full messages
   - "What to do" suggestion per error category
   - "Retry" / "Export logs" / "Check settings" buttons

3. **Error history** — Store the last 50 sync failures in IndexedDB with:
   - Timestamp, error count, error summary
   - Link to the auto-captured sync trace (from Solution B)
   - Whether the next sync succeeded (recovery tracking)

**Estimated effort:** 3–5 hours
**Risk:** Low

### 3.4 Solution D — Live Sync Progress Indicator

**Goal:** Give users real-time feedback during a sync about what's happening, rather than just a spinning icon.

**Implementation:**

1. **Status bar detail** — Enrich the status bar text with progressive information:

```
Phase 1/4: Walking local files (42 found)...
Phase 2/4: Walking remote files (18 found)...
Phase 3/4: Comparing (3 changes detected)...
Phase 4/4: Applying changes (2 uploads, 1 delete)...
✓ Sync complete (12s) — 3 changes applied
```

2. **Sync progress modal** — Optional: add a collapsible progress panel that shows:
   - Current file being transferred (with filename)
   - Transfer speed for the current file
   - Overall progress bar (x of y files)
   - Recent completed operations (scrollable list)

3. **Implementation**:
   - Extend the `syncRun()` callback system with progress events
   - Use Obsidian's `StatusBar` API for the compact view
   - Keep the modal optional (opt-in via settings) for users who prefer minimal UI

**Estimated effort:** 3–4 hours
**Risk:** Low — mostly UI additions, no core logic changes.

---

## 4. Implementation Roadmap

### Phase 1 — Quick wins (next release)

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 1A | In-app log viewer modal | 4h | — |
| 1D | Live sync progress in status bar | 2h | — |
| 1C | Error categorization in failure notices | 2h | — |
| 1E | Make debug section always visible (rename to "Troubleshooting") | 30min | — |

### Phase 2 — Deep diagnostics (next + 1 release)

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 2A | SyncTracer class with operation recording | 4h | 1B (profiler refactor) |
| 2B | Waterfall visualization modal | 3h | 2A |
| 2C | Auto-capture trace on sync failure | 1h | 2A, 1C |
| 2D | Error history in IndexedDB | 2h | 1C |

### Phase 3 — Polish

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 3A | Persistent log storage in IndexedDB | 2h | 1A |
| 3B | Log/trace export to markdown files | 1h | 1A, 2A |
| 3C | "What to do" suggestions per error category | 2h | 1C |

---

## 5. Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Log storage grows unbounded** — IndexedDB could fill up with verbose debug logs. | Cap at 10,000 entries or 5 MB. Auto-prune oldest entries. |
| **Tracing overhead slows sync** — Recording every API call adds allocation pressure. | `SyncTracer` is opt-in (enabled via toggle). Default off. When enabled, use a ring buffer of max 5000 ops. |
| **UI clutter** — Adding modals, buttons, and progress panels could overwhelm the settings page. | Group debugging features under a single "Troubleshooting" section. Make progress modal opt-in. |
| **Cross-version log format changes** — If the log format changes, old persisted logs become unreadable. | Use a versioned schema in IndexedDB. On load, drop entries with mismatched version. |

---

## 6. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time to diagnose a sync failure | 15+ min (open dev tools, reproduce, inspect) | < 2 min (open log viewer, filter by error) |
| User ability to share debug info | "Check the console" (requires dev tools knowledge) | One-click "Export logs" button |
| Profiler adoption | Near zero (hidden, must enable pre-sync) | Users can retroactively inspect last N syncs |
| Sync progress feedback | Spinning icon only | Clear phase + file-level progress |
| Error recovery rate (user fixes issue after seeing error) | Unknown | Measurable via error history → success tracking |

---

## 7. Open Questions

1. **Should the log viewer be a modal or a dedicated settings tab?** A modal is simpler to implement and doesn't interfere with the settings layout. But a dedicated tab could offer richer filtering. Recommendation: start with a modal, evaluate user feedback.

2. **Should we remove `showDeveloperOptions` entirely?** The concept of "developer options" creates confusion. Better to rename "Debug" to "Troubleshooting" and make it always visible, with a sub-section "Advanced diagnostics" that has a clearer description.

3. **Should sync traces be deletable individually?** Yes — users should be able to prune old traces without clearing the entire database. Add a "Manage traces" UI similar to "Manage sync plans".

4. **Should we integrate with Obsidian's built-in `console` and `Debug` API?** Obsidian has a `requireApiVersion()` check. If Obsidian ever exposes a debugging API, we should prefer it over our own interception layer.
