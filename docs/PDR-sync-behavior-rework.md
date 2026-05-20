# PDR — Sync Behavior Rework: Journal-Based Resilient Sync

> **Product Definition Requirement**
> Date: 2026-05-20
> Status: Draft
> Author: AI-assisted analysis

---

## 1. Executive Summary

The current sync algorithm (v3) is a **stateless three-way comparison** that runs a full reconciliation between local files, remote files, and the previous sync snapshot (prevSync) on every cycle. This approach is:

- **Expensive** — requires walking both the entire local vault and the entire remote storage on every sync
- **Fragile** — any interruption (network drop, app crash, concurrent modification) can leave the sync state inconsistent
- **Non-incremental** — even if only one file changed, the full comparison runs again

This PRD proposes a **journal-based sync engine** inspired by Nextcloud Desktop Client, rsync's `--itemize-changes`, and modern file synchronization systems. Instead of re-comparing everything, the new engine tracks file system events locally, journals pending changes, and processes them incrementally. This makes sync faster, more resilient, and capable of handling partial/interrupted syncs gracefully.

---

## 2. Current State Analysis

### How the v3 Algorithm Works

```
                    ┌──────────────────┐
                    │   syncRun()      │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Walk Local     Walk Remote    Load prevSync
        (vault scan)   (ListObjects)  (IndexedDB)
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                    Build MixedEntityMap
                    (three-way merge)
                             │
                             ▼
                     Resolve decisions
                    (entityEquals logic)
                             │
                             ▼
                    doActualSync()
                    (apply transfers &
                     deletions)
```

**Key characteristics:**

1. **Full walk every time** — `fsLocal.walk()` reads every file in the vault. `fsEncrypt.walk()` lists every object on the remote. For a vault with 10,000 files, that's 10,000 local stat calls + N remote API calls every sync cycle.
2. **Comparison is pure in-memory** — The three-way merge (`buildMixedEntityMap` → `resolveFileDecision`) is fast, but the I/O to build the inputs is not.
3. **Stateless prevSync** — The previous sync state is stored as a flat key-value map in IndexedDB (`prevSyncRecordsTbl`). There's no concept of "incremental since last sync" — it's always a full diff against the entire snapshot.
4. **Pending ops exist but are unused** — `localdb.ts` defines `addPendingOp`, `getPendingOps`, `clearPendingOps` and `syncEngine.ts` has `processPendingOps()`, but **`addPendingOp` is never called anywhere**. The infrastructure is there but not wired to Obsidian's vault events.
5. **No change journal** — There's no record of *what changed between syncs*, only a snapshot of *what existed at last sync*.
6. **No partial sync recovery** — If `doActualSync()` fails mid-way (e.g., 50 of 100 transfers complete, then network drops), the next sync re-runs the full comparison. Some completed transfers are re-downloaded/re-uploaded.

### What Users Experience

| Scenario | Current Behavior | Desired Behavior |
|----------|-----------------|------------------|
| Edit one file, sync | Full walk (local + remote), full comparison, then 1 transfer | Detect the change, do 1 transfer |
| 100 files added externally (e.g., git clone) | Full walk, 100% change, protectModifyPercentage blocks sync | Journal detects 100 new files, syncs them |
| Network failure mid-sync | Next sync re-does everything from scratch | Resume from checkpoint |
| Sync on save | Timer-based (every N ms after last save) or manual | Event-driven (sync as soon as a file changes) |
| Large vault (50k+ files) | Slow walk dominates sync time | Only walk the changed paths |

---

## 3. Proposed Architecture: Journal-Based Sync

### 3.1 Core Concept

Replace the "full comparison every time" model with an **event-driven change journal**:

```
 Obsidian Vault Events           Remote Changes
       │                              │
       ▼                              ▼
 ┌─────────────┐            ┌─────────────────┐
 │ Local       │            │ Remote Change    │
 │ Change      │            │ Detection        │
 │ Journal     │            │ (optional:       │
 │ (IndexedDB) │            │  webhook/poll)   │
 └──────┬──────┘            └────────┬─────────┘
        │                            │
        └──────────┬─────────────────┘
                   ▼
        ┌─────────────────────┐
        │  Incremental Sync   │
        │  Engine             │
        │  - Process journal  │
        │  - Apply changes    │
        │  - Update journal   │
        └─────────────────────┘
```

### 3.2 Solution A — Local Change Journal via Vault Events

**Goal:** Track every local file change (create, modify, delete, rename) by subscribing to Obsidian's vault events, and persist the change in a local journal.

**Implementation:**

1. **Wire up vault events** — In `main.ts`, add event listeners in `onload()`:

```typescript
this.registerEvent(this.app.vault.on("create", (file) => {
  if (this.settings.syncOnSaveAfterMilliseconds >= 0) {
    addPendingOp(this.db, this.vaultRandomID, this.getCurrProfileID(), {
      type: "create",
      key: file.path,
      timestamp: Date.now(),
    });
    this.debouncedSyncOnSave();
  }
}));

this.registerEvent(this.app.vault.on("modify", (file) => {
  if (this.settings.syncOnSaveAfterMilliseconds >= 0) {
    addPendingOp(this.db, this.vaultRandomID, this.getCurrProfileID(), {
      type: "modify",
      key: file.path,
      timestamp: Date.now(),
    });
    this.debouncedSyncOnSave();
  }
}));

this.registerEvent(this.app.vault.on("delete", (file) => {
  addPendingOp(this.db, this.vaultRandomID, this.getCurrProfileID(), {
    type: "delete",
    key: file.path,
    timestamp: Date.now(),
  });
}));

this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
  addPendingOp(this.db, this.vaultRandomID, this.getCurrProfileID(), {
    type: "rename",
    key: oldPath,
    newKey: file.path,
    timestamp: Date.now(),
  });
}));
```

2. **Debounced sync trigger** — On each `create`/`modify` event, debounce the actual sync start:

```typescript
private debouncedSyncOnSave = _.debounce(
  () => this.syncRun("sync_on_save"),
  this.settings.syncOnSaveAfterMilliseconds
);
```

3. **Journal deduplication** — Before inserting a new pending op, check if there's already an op for the same key. Merge operations:
   - `modify` after `create` → keep `create` (it subsumes the modify)
   - `delete` after `create` → remove both (file created and deleted before sync)
   - `rename` after `create` → update the rename's oldKey if the created key matches
   - Multiple `modify` → only keep the latest (timestamp)

4. **Journal persistence** — Use the existing `simpleKVForMiscTbl` in IndexedDB (already defined in `localdb.ts`). The journal entries are durable across app restarts.

**Estimated effort:** 4–6 hours
**Risk:** Low-Medium — the infrastructure (`PendingOp`, `processPendingOps`) already exists; only the event wiring and deduplication are new.

### 3.3 Solution B — Incremental Sync (Skip Full Walk When Possible)

**Goal:** When the change journal has entries, skip the full local and remote walks and only process the changed keys.

**Implementation:**

1. **New sync mode: `incremental`** — Add a sync path that:
   - Reads the pending ops journal
   - For each changed key, reads the current local entity (stat) and current remote entity (head)
   - Applies the same decision logic as v3 but only for the changed paths
   - Does NOT walk the entire local or remote storage

2. **Fallback to full sync** — When the journal is empty (first sync), or too many changes accumulated (>N), or a full sync was explicitly requested, fall back to the current v3 algorithm.

3. **Change accumulation threshold** — If the journal has more than `maxJournalEntries` (default: 1000) pending ops, the incremental approach becomes counterproductive (too many individual stat calls). In that case, fall back to a full walk.

4. **Remote change detection heuristic** — Since the plugin cannot receive push notifications from S3/WebDAV, we need a lightweight way to detect remote changes:
   - Store the last sync's remote listing **summary** (total object count, last-modified timestamp of the most recent object)
   - On incremental sync, do a fast check: `ListObjectsV2` with `max-keys=1` sorted by `LastModified` descending. If the newest object is newer than our last sync, schedule a full sync.
   - This catches remote-side changes (another client synced, file uploaded via web UI) without walking the entire bucket.

5. **Modified `syncer()` flow:**

```
syncer(triggerSource):
  1. Load pending ops from journal
  2. If journal empty → run full v3 sync (as today)
  3. If journal has entries:
     a. Sort by timestamp
     b. For each op:
        - Get current local entity (fsLocal.stat)
        - Get current remote entity (fsEncrypt.statSingle)
        - Get prevSync entity (from IndexedDB)
        - Apply decision logic (same entityEquals)
        - Execute the transfer/deletion
        - Update prevSync record
        - Remove op from journal
     c. Remote change detection check (lightweight ListObjects)
        - If remote might have changed → schedule a full sync after
  4. Done
```

**Estimated effort:** 8–12 hours
**Risk:** High — this is a fundamental change to the sync engine. The incremental path must handle edge cases (conflicts, renames, folder operations) correctly.

### 3.4 Solution C — Checkpoint-Based Partial Sync Recovery

**Goal:** If a sync is interrupted mid-transfer, resume from the last successful checkpoint rather than re-doing all transfers.

**Implementation:**

1. **Sync checkpoint table** — Add a new table in IndexedDB:

```typescript
interface SyncCheckpoint {
  syncId: string;        // unique per sync run
  vaultRandomID: string;
  profileID: string;
  startedAt: number;
  totalOps: number;
  completedOps: number;
  lastCompletedKey: string;
  status: "in_progress" | "completed" | "failed";
  errorMessage?: string;
}
```

2. **Checkpoint updates during sync** — In `doActualSync()`, after each successful transfer/deletion:

```typescript
await upsertSyncCheckpoint(db, vaultRandomID, profileID, {
  syncId,
  completedOps: ++completedCount,
  lastCompletedKey: key,
  status: "in_progress",
});
```

3. **Resume on next sync** — On `syncRun()`, check if there's an `in_progress` checkpoint. If so:
   - Offer to resume (or auto-resume if `triggerSource !== "manual"`)
   - Skip already-completed keys (check against `lastCompletedKey`)
   - Continue from where it left off

4. **Stale checkpoint cleanup** — Delete checkpoints older than 24 hours. A checkpoint that old likely means the app was closed mid-sync and the state is stale.

**Estimated effort:** 4–6 hours
**Risk:** Medium — must handle the case where the local or remote state changed while the sync was interrupted (e.g., file was modified locally between the failed sync and the resume).

### 3.5 Solution D — Remote Change Detection via ETag/Version Tracking

**Goal:** Detect remote-side changes without a full listing by tracking remote object versions or ETags.

**Implementation:**

1. **Store remote metadata snapshot** — After each successful full sync, store a compact snapshot:

```typescript
interface RemoteSnapshot {
  vaultRandomID: string;
  profileID: string;
  syncedAt: number;
  objectCount: number;
  newestObjectMtime: number;
  // Optional: store ETags for quick equality check
  // etagMap: Record<string, string>; — only for files, truncated to first 1000
}
```

2. **Fast remote change check** — Before the incremental sync, do:
   - S3: `ListObjectsV2` with `max-keys=1`, `prefix=""`, sorted by `LastModified` descending
   - WebDAV: `stat` on the remote root directory, check `lastmod`
   - Compare `newestObjectMtime` with stored snapshot
   - If newer → remote has changes → run a full sync instead of incremental

3. **Opt-in for S3 only** — This optimization is most valuable for S3 (where listing is cheap for 1 key but expensive for 10,000). For WebDAV, a full listing may be comparable in cost to a stat.

**Estimated effort:** 3–4 hours
**Risk:** Low — pure optimization, no correctness impact.

### 3.6 Solution E — Unified Sync State Table

**Goal:** Replace the flat `prevSyncRecordsTbl` with a structured sync state that records not just the last-sync snapshot but also sync history, conflict markers, and metadata.

**Implementation:**

1. **New schema** — Migrate from the current `{vaultRandomID}\t{profileID}\t{fileKey} → Entity` to a richer structure:

```typescript
interface SyncStateEntry {
  key: string;
  localVersion: {
    mtime: number;
    size: number;
    etag?: string;     // content hash (MD5 or SHA-256)
    checksum?: string;  // for content-based change detection
  };
  remoteVersion: {
    mtime: number;
    size: number;
    etag?: string;
  };
  lastSyncedAt: number;
  syncStatus: "synced" | "pending_push" | "pending_pull" | "conflict";
  conflictBase?: string;  // the version before conflict (for diff3)
  history: Array<{
    timestamp: number;
    direction: "push" | "pull" | "delete";
    version: string;       // content hash or "deleted"
  }>;
}
```

2. **Benefits**:
   - Clear "pending" status eliminates the need for a separate pending ops table
   - Conflict base versions enable proper three-way merge conflict resolution
   - History enables undo/rollback of sync operations
   - ETag/checksum enables content-based change detection (beyond mtime)

3. **Migration** — Write a one-time migration script that converts existing `prevSyncRecordsTbl` entries to the new format, setting all to `synced` status.

**Estimated effort:** 8–10 hours
**Risk:** High — schema change affects all existing users. Must have robust migration and rollback.

---

## 4. Implementation Roadmap

### Phase 1 — Quick wins (next release)

| # | Task | Effort | Risk | Depends on |
|---|------|--------|------|------------|
| 1A | Wire up vault events → pending ops (create/modify/delete/rename) | 3h | Low | — |
| 1A | Pending op deduplication (merge adjacent ops on same key) | 2h | Low | 1A |
| 1A | Debounced sync-on-save via journal events | 1h | Low | 1A |
| 1D | Remote change detection (lightweight check before full sync) | 3h | Low | — |

### Phase 2 — Incremental sync (next + 1 release)

| # | Task | Effort | Risk | Depends on |
|---|------|--------|------|------------|
| 2B | Incremental sync path (skip full walk when journal has entries) | 8h | High | 1A |
| 2B | Fallback logic (journal too large → full sync) | 2h | Low | 2B |
| 2B | statSingle for remote (HeadObject / stat) | 2h | Low | 2B |
| 2E | Unified SyncState table migration | 8h | High | — |

### Phase 3 — Resilience & recovery

| # | Task | Effort | Risk | Depends on |
|---|------|--------|------|------------|
| 3C | Checkpoint system (sync resume after interruption) | 4h | Medium | 2B |
| 3C | Stale checkpoint cleanup | 1h | Low | 3C |
| 3E | Content-based change detection (checksum comparison) | 4h | Medium | 2E |

### Phase 4 — Polish & edge cases

| # | Task | Effort | Risk | Depends on |
|---|------|--------|------|------------|
| 4A | Conflict base version for three-way merge | 3h | Medium | 2E |
| 4A | Sync history viewer in settings | 3h | Low | 2E |
| 4B | Sync stats in status bar (pending count, last N ops) | 2h | Low | 1A |

---

## 5. Detailed Design: Incremental Sync Engine

### 5.1 Flow Diagram

```
syncRun(triggerSource)
│
├─ Load journal (pending ops) from IndexedDB
│
├─ IF journal empty AND not forced full sync:
│   ├─ Lightweight remote check (1 API call)
│   ├─ IF remote unchanged → skip (nothing to do)
│   └─ IF remote changed → fall through to full sync
│
├─ IF journal has entries:
│   ├─ Deduplicate + sort by timestamp
│   ├─ IF journal.length > MAX_JOURNAL (1000):
│   │   └─ Fall through to full sync
│   ├─ FOR each op:
│   │   ├─ Get local entity (fsLocal.stat)
│   │   ├─ Get remote entity (fsEncrypt.statSingle or walk cached)
│   │   ├─ Get prevSync entity (IndexedDB)
│   │   ├─ Resolve file decision
│   │   ├─ Apply transfer/deletion
│   │   ├─ Update prevSync
│   │   ├─ Remove op from journal
│   │   └─ Update checkpoint
│   └─ Done
│
├─ ELSE (full sync):
│   └─ Current v3 algorithm
│
└─ Update last sync timestamp
```

### 5.2 Pending Op Deduplication Rules

When adding a new op, check for existing ops on the same key:

| Existing | New | Result |
|----------|-----|--------|
| `create` | `modify` | Keep `create` (subsumes modify) |
| `create` | `delete` | Remove both (net no-op) |
| `create` | `rename` | Change old `create` key to new key |
| `modify` | `modify` | Keep only new (update timestamp) |
| `modify` | `delete` | Change to `delete` |
| `modify` | `rename` | Keep `rename` (subsumes modify) |
| `delete` | `create` | Change to `modify` |
| `delete` | `modify` | Keep `create`+`modify` → `modify` |
| `rename` | `modify` on new key | Keep `rename` (already implies the new file exists) |
| `rename` | `delete` on old key | Ignore (old key no longer exists) |
| `rename` | `rename` again | Update newKey to latest |

### 5.3 Conflict Handling in Incremental Mode

When processing an incremental op, a conflict is detected if:

- **Local modified + Remote modified since last sync** → both sides changed
- **Local modified + Remote deleted** → remote deletion lost
- **Local deleted + Remote modified** → local deletion lost

Resolution follows the existing `conflictAction` setting (`keep_newer` / `keep_larger`) with the same decision matrix as v3, but only for the single file being processed.

When a conflict is detected in incremental mode, the file is:
1. Recorded as `conflict` in the SyncState
2. The decision from `conflictAction` is applied
3. If `keep_newer`, the older version is backed up with a `.conflict-{timestamp}` suffix
4. The journal entry is removed

### 5.4 Folder Operation Handling

Folder operations are NOT journaled individually (creating/deleting folders is handled implicitly by file operations). However:

- **Folder creation** — When a file is created in a new subdirectory, the parent folder path is checked on the remote. If absent, `fsEncrypt.mkdir` is called first (already the current behavior).
- **Folder deletion** — When the last file in a folder is deleted, the empty folder is cleaned up according to `howToCleanEmptyFolder` setting.

---

## 6. Migration from v3

### Backward Compatibility

The new incremental engine must coexist with the existing v3 algorithm. Migration strategy:

1. **Phase 1**: Wire up journal without changing sync behavior. Pending ops are recorded but the sync engine still runs the full v3 algorithm. This validates that the journal captures changes correctly.
2. **Phase 2**: Add incremental mode as opt-in. A new setting `syncMode: "v3" | "journal"` defaults to `"v3"`. Power users can switch to `"journal"`.
3. **Phase 3**: After validation in the field, make `"journal"` the default for new installs.
4. **Phase 4**: Deprecate `"v3"` mode entirely and remove the old walk-based path.

### Data Migration

When upgrading from v3 to journal mode:
- The existing `prevSyncRecordsTbl` entries are already a snapshot of the last successful sync.
- On first journal-mode sync, treat all existing prevSync entries as "synced" and start journaling new changes.
- If the journal is empty on first run, do a full v3-style sync to establish the baseline, then switch to incremental.

---

## 7. Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Vault event reliability** — Obsidian's `vault.on("create"/"modify"/"delete")` may miss events on mobile or during plugin initialization. | Journal is a cache, not source of truth. Always fall back to full sync if the journal is suspiciously empty (e.g., more than 24h since last sync, or app was just updated). |
| **Event storms** — Bulk operations (git clone, Obsidian sync, folder import) generate thousands of events in seconds. | Debounce sync trigger. Cap journal at 1000 entries before forcing a full sync. Deduplicate aggressively. |
| **Remote changes undetected** — The plugin cannot receive webhooks from S3/WebDAV. If another client modifies a file, the lightweight remote check might miss it. | The lightweight check (newest object mtime) catches most cases. Schedule a periodic full sync (e.g., every 10th sync or every 24h) as a safety net. |
| **Concurrent modifications during incremental sync** — If the user edits a file while the incremental sync is running. | The sync processes one op at a time. If a file is modified after its op is processed, the next vault event creates a new journal entry for the next sync cycle. |
| **Rename tracking across folders** — Obsidian's rename event gives both old and new path. If a file is renamed and then modified, the journal must track the new path. | Deduplication rules handle this: rename → modify on new key results in a single rename op (the modify is subsumed). |
| **IndexedDB quota** — The journal, sync state, and checkpoints all compete for IndexedDB space. | Cap journal at 1000 entries. Cap SyncState at 50,000 entries (prune old versions). Cap checkpoint at 1 entry. |
| **Conflict resolution quality** — The current `keep_newer`/`keep_larger` is crude. With richer sync state, we could do proper three-way merge for text files. | Future enhancement. Start with existing conflict actions. Add `.conflict-{ts}` backup for the losing version. |

---

## 8. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Sync time for 1 edited file (10k vault) | ~30s (full walk + comparison) | ~2s (1 stat + 1 head + 1 transfer) |
| Sync-on-save latency | ~30s (full cycle) | ~3s (incremental) |
| Interrupted sync recovery | Full re-sync (re-download everything) | Resume from last checkpoint |
| Pending operations tracking | Not used (infrastructure exists but unwired) | Tracks every file change between syncs |
| Remote change detection | Full listing every time | 1 API call to check if remote changed |
| Conflict resolution | `keep_newer` with no backup | `keep_newer` + `.conflict-{ts}` backup of losing version |

---

## 9. Open Questions

1. **Should the incremental sync be the default or opt-in?** Opt-in for the first release, default after field validation. Users who never change files between syncs (e.g., archive vaults) benefit less from incremental and more from the simplicity of full sync.

2. **Should we use content hashing (MD5/SHA-256) for change detection?** Hashes are more accurate than mtime+size but require reading the file content. For incremental sync of modified files, the content is already being read for transfer, so the hash is essentially free. For unmodified files, the mtime+size check is sufficient and avoids reading content. Recommendation: use hash only for transfer operations, not for comparison.

3. **How do we handle the "sync on save" vs "auto sync every N minutes" interaction?** With the journal, "sync on save" becomes "sync as soon as the user stops editing for N ms". The periodic timer becomes a safety net for remote changes. The two can coexist: sync-on-save handles local→remote, periodic timer handles remote→local and full reconciliation.

4. **Should the checkpoint system survive app restart?** Yes, checkpoints are stored in IndexedDB. On app load, if an `in_progress` checkpoint exists and is less than 1 hour old, prompt the user to resume. This handles crashes and forced app closures.

5. **Should we add a "Sync queue" UI that shows pending operations?** Yes, similar to Nextcloud's "Activity" or "Not synced" list. A small indicator in the status bar showing "3 pending changes" with a clickable modal. This gives users visibility into what will happen on the next sync.
