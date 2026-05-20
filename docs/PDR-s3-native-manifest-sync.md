# PDR — Native S3 Multi-Device Sync via Remote Manifest

> **Product Definition Requirement**
> Date: 2026-05-20
> Status: Draft
> Author: AI-assisted analysis

---

## 1. Executive Summary

Currently, the sync engine stores the "prevSync" state (the third point in the three-way merge) exclusively in local IndexedDB. This works acceptably for single-device usage, but breaks down in S3-based multi-device scenarios:

- Each device has its own IndexedDB with its own prevSync records.
- When device B syncs for the first time after device A has synced, device B has **no** prevSync records corresponding to the current remote state.
- The engine sees: `local ≠ nothing (prevSync)` and `remote ≠ nothing (prevSync)` → mass conflicts or a full resync.
- Even when prevSync exists, the engine still does a **full walk of the entire remote** (ListObjectsV2) every sync cycle.
- If IndexedDB is cleared (browser eviction, device change, accidental wipe), all sync state is lost.

**Solution:** Store the sync manifest *directly on S3* as a JSON file. This manifest becomes the shared, multi-device "prevSync" state. By comparing the manifest against a minimal remote scan (just keys + ETags, no content), the engine can detect changes without walking all objects. After each sync, the manifest is updated with the latest state.

### Key insight

> S3 is a key-value store with ETags. We can store 1 file (the manifest) that encodes the state of 10,000+ files. Reading 1 file + listing 200 keys is much cheaper than reading all 10,000+ files or listing all of them without a cursor.

---

## 2. Current Problems

### Problem 1 — Multi-device sync always does a full walk

**Root cause:** Each device has its own IndexedDB. `prevSync` records from device A are invisible to device B. When device B syncs, it loads an empty `prevSyncEntityList`, so every file becomes "created" (no prevSync, no remote match, or remote match but as "conflict_created"). The engine then falls into the full three-way comparison, walking **all** remote objects.

**Impact:** 10,000 files on S3 → 10,000+ HTTP requests (ListObjectsV2 pagination + optional HeadObject calls). 30–120 seconds of API calls before any actual sync work starts.

### Problem 2 — IndexedDB state loss forces full resync

**Root cause:** IndexedDB is browser storage. It can be evicted under memory pressure, cleared by the user, or lost when switching devices. There is no external backup of the prevSync state.

**Impact:** If any device loses its IndexedDB, the next sync from that device triggers a full walk + mass "conflict_created" decisions, which either blocks the sync (protectModifyPercentage) or forces a full resync.

### Problem 3 — Full ListObjectsV2 is expensive

**Root cause:** `_walkFromRoot()` in `FakeFsS3` does paginated `ListObjectsV2Command` calls. For 10,000 objects with default `MaxKeys=1000`, that's 10 sequential API calls. If `useAccurateMTime` is on, it's 10 list calls + 10,000 HeadObject calls.

**Impact:** High latency on startup, high API costs on pay-per-request providers (e.g., Wasabi, Backblaze B2).

### Problem 4 — Incremental sync still walks the full remote

**Root cause:** Even with the pending ops journal (sync behavior rework), the `syncer()` function always calls `fsEncrypt.walk()` at step 3, which triggers a full remote walk. The `checkRemoteChanges()` function exists but is only used to store a snapshot *after* sync, not to *skip* the walk.

**Impact:** Incremental mode only skips the local walk, not the remote walk. The remote walk is the expensive part for S3.

---

## 3. Proposed Solution: Remote Manifest

### 3.1 Manifest File Format

A single JSON file stored at a well-known S3 key:

```
_rs_state/<vaultRandomID>/manifest.json
```

```typescript
interface RemoteManifest {
  /** Schema version for forward compatibility */
  version: number;
  /** The vault this manifest belongs to */
  vaultRandomID: string;
  /** Unix ms timestamp when this manifest was written */
  syncedAt: number;
  /** Sync session ID that produced this manifest */
  syncId: string;
  /** Per-file state map. Key = local file path */
  files: Record<string, ManifestEntry>;
  /** Summary for quick change detection */
  summary: {
    /** Total number of tracked files */
    fileCount: number;
    /** Newest mtime across all tracked files */
    newestMtime: number | null;
  };
}

interface ManifestEntry {
  /** S3 ETag of the remote object */
  etag: string;
  /** Client-side mtime (from the original filesystem) */
  mtime: number;
  /** File size in bytes */
  size: number;
  /** Whether the file is encrypted on remote */
  encrypted: boolean;
}
```

### 3.2 Sync Algorithm with Manifest

#### New flow (replaces current step 3-5 for S3):

```
┌─────────────────────────────────────────────┐
│ 1. Try to read manifest from S3              │
│    (1 GET request)                           │
├─────────────────────────────────────────────┤
│ 2. Lightweight remote scan                   │
│    ListObjectsV2 with MaxKeys=500             │
│    Collect {key → etag} pairs                │
│    (1-2 API calls regardless of total files) │
├─────────────────────────────────────────────┤
│ 3. Diff: manifest vs remote scan             │
│    → Find: new, modified, deleted on remote   │
│    → Build remoteEntityList from manifest     │
│      + apply diffs                           │
├─────────────────────────────────────────────┤
│ 4. Local walk (full or incremental)          │
│    → Same as today                           │
├─────────────────────────────────────────────┤
│ 5. Use manifest state as prevSync            │
│    (replaces IndexedDB prevSync entirely)    │
├─────────────────────────────────────────────┤
│ 6. Three-way merge:                          │
│    local ↔ manifest(prevSync) ↔ remote       │
├─────────────────────────────────────────────┤
│ 7. Execute decisions                         │
├─────────────────────────────────────────────┤
│ 8. Write updated manifest to S3              │
│    (1 PUT request)                           │
└─────────────────────────────────────────────┘
```

#### Key improvements:

| Step | Before | After |
|------|--------|-------|
| Remote walk | Full ListObjectsV2 (paginated, N calls) | 1 GET (manifest) + 1 ListObjectsV2 (500 keys) |
| PrevSync source | Local IndexedDB only | S3 manifest (shared across devices) |
| Multi-device | Each device has own prevSync | All devices share one manifest |
| State recovery | Impossible if IndexedDB cleared | Recover manifest from S3 |
| First sync on new device | Full walk + potential protectModifyPercentage block | Read manifest + diff with local |

### 3.3 How Multi-Device Coordination Works

1. Device A syncs. After completion, it writes manifest.json to S3 with the state of all files.
2. Device B syncs an hour later:
   - Reads manifest.json from S3 → learns what Device A synced
   - Does a lightweight remote scan → sees all ETags match the manifest
   - Does a local walk → sees any local changes since Device B's last local modification
   - Three-way merge: local_changes ↔ manifest ↔ remote (unchanged)
   - Device B only transfers its own local changes
3. No special locking or conflict resolution needed — the manifest is a snapshot, not a lock. If two devices sync simultaneously, the last writer wins (manifest gets overwritten). The next sync from either device will reconcile any differences via normal three-way merge.

### 3.4 Fallback When Manifest Is Missing

When the manifest doesn't exist on S3 (first sync ever, or corrupted), fall back to the current behavior:
- Full remote walk (ListObjectsV2)
- Load prevSync from IndexedDB as before
- After sync completes, write the manifest for future use

This ensures backward compatibility: existing users can enable the manifest feature and it will start working after their next sync.

### 3.5 Lightweight Remote Scan Implementation

Instead of a full paginated ListObjectsV2, we do a **bounded scan**:

```typescript
async function getManifestDiff(
  s3Client: S3Client,
  bucket: string,
  prefix: string,
  manifest: RemoteManifest
): Promise<{
  remoteEntities: Entity[];       // current remote state (built from manifest + diffs)
  changedKeys: string[];          // keys that changed on remote
  deletedKeys: string[];          // keys deleted on remote
}> {
  // Do a paginated list, but stop early if we've confirmed manifest is fresh
  const remoteEntries: { key: string; etag: string; lastModified: Date }[] = [];
  let isTruncated = true;
  let continuationToken: string | undefined;
  
  while (isTruncated) {
    const rsp = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    }));
    
    for (const obj of rsp.Contents ?? []) {
      remoteEntries.push({
        key: obj.Key!,
        etag: obj.ETag ?? "",
        lastModified: obj.LastModified ?? new Date(0),
      });
    }
    
    isTruncated = rsp.IsTruncated ?? false;
    continuationToken = rsp.NextContinuationToken;
  }
  
  // Compare with manifest
  const manifestByKey = new Map(Object.entries(manifest.files));
  const remoteByKey = new Map(remoteEntries.map(e => [e.key, e]));
  
  const changedKeys: string[] = [];
  const deletedKeys: string[] = [];
  
  for (const [key, remoteEntry] of remoteByKey) {
    const manifestEntry = manifestByKey.get(key);
    if (!manifestEntry) {
      // New on remote
      changedKeys.push(key);
    } else if (manifestEntry.etag !== remoteEntry.etag) {
      // Modified on remote
      changedKeys.push(key);
    }
  }
  
  for (const key of manifestByKey.keys()) {
    if (!remoteByKey.has(key)) {
      deletedKeys.push(key);
    }
  }
  
  // Build remote entity list from manifest, with overrides for changed keys
  const remoteEntities: Entity[] = [];
  for (const [key, entry] of manifestByKey) {
    if (!remoteByKey.has(key)) continue; // deleted
    remoteEntities.push({
      key: stripPrefix(key, prefix),
      keyRaw: stripPrefix(key, prefix),
      etag: entry.etag,
      size: entry.size,
      sizeRaw: entry.size,
      mtimeCli: entry.mtime,
      mtimeSvr: entry.mtime,
    });
  }
  // Add new remote entries (not in manifest)
  for (const [key, remoteEntry] of remoteByKey) {
    if (!manifestByKey.has(key)) {
      remoteEntities.push({
        key: stripPrefix(key, prefix),
        keyRaw: stripPrefix(key, prefix),
        etag: remoteEntry.etag,
        size: 0,
        sizeRaw: 0,
        mtimeCli: remoteEntry.lastModified.getTime(),
        mtimeSvr: remoteEntry.lastModified.getTime(),
      });
    }
  }
  
  return { remoteEntities, changedKeys, deletedKeys };
}
```

**Optimization:** If the count of remote entries differs from the manifest count by more than a threshold, or if the newest mtime changed, we know the manifest is stale and a deeper scan is needed. But we **never** need HeadObject calls — ETags from ListObjectsV2 are sufficient.

### 3.6 Integration with Existing Code

**No changes to the three-way merge engine** (`syncEngine.ts`). The three-way merge (`ensembleMixedEnties` → `getSyncPlanInplace` → `doActualSync`) remains identical. All changes are in:

1. **`fsS3.ts`** — Add manifest read/write, add `walkWithManifest()` that replaces `walk()` for the manifest path
2. **`fsAll.ts`** — Add abstract `readManifest()` / `writeManifest()` methods
3. **`syncEngine.ts`** — New `syncerS3()` path that uses manifest instead of full walk for S3
4. **`localdb.ts`** — No changes needed (manifest replaces IndexedDB prevSync for S3)
5. **`main.ts`** — Route S3 syncs through the new manifest-aware path

### 3.7 Filtering the Manifest

The manifest should only track **files that are within the sync scope** (respecting `ignorePaths`, `onlyAllowPaths`, `syncConfigDir`, etc.). This keeps the manifest small and ensures it doesn't store state for files the user doesn't want synced.

Filtering happens:
1. When **writing** the manifest (after sync): only include files that were part of the sync plan with `decision !== "equal"` or `decision === "equal"` (i.e., all tracked files).
2. When **reading** the manifest: apply the same filter to skip irrelevant entries.

---

## 4. Implementation Roadmap

### Phase 1 — Remote Manifest on S3 (Core)

| # | Task | Effort | Risk | Dependencies |
|---|------|--------|------|-------------|
| 1.1 | Add manifest types, read/write to `FakeFsS3` + `FakeFs` abstract base | 2h | Low | None |
| 1.2 | Implement `walkWithManifest()` in `FakeFsS3` — reads manifest + bounded scan | 4h | Medium | 1.1 |
| 1.3 | Add `syncerS3Manifest()` to `syncEngine.ts` — new sync path that uses manifest | 4h | Medium | 1.2 |
| 1.4 | Wire manifest path in `main.ts` — detect S3, use new syncerS3Manifest | 1h | Low | 1.3 |
| 1.5 | Write manifest after successful sync | 1h | Low | 1.1 |

### Phase 2 — Multi-Device Polish

| # | Task | Effort | Risk |
|---|------|--------|------|
| 2.1 | Handle manifest conflicts (concurrent writes) gracefully | 2h | Low |
| 2.2 | Add setting toggles: "Use remote manifest" (default on for S3) | 1h | Low |
| 2.3 | Migration: add `manifestVersion` to existing manifests | 1h | Low |
| 2.4 | Fallback when manifest is corrupted or stale | 2h | Medium |

### Phase 3 — Optimization

| # | Task | Effort | Risk |
|---|------|--------|------|
| 3.1 | Skip full bounded scan — use manifest only + checkRemoteChanges | 2h | Medium |
| 3.2 | Incremental manifest update (append-only instead of full rewrite) | 3h | High |
| 3.3 | Compress manifest (gzip) for large vaults | 1h | Low |

---

## 5. Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Manifest file grows large** (50K+ files) | JSON compression, or split into shards. For 50K files, a naive JSON is ~5MB. Compressed with gzip this is ~500KB. Acceptable for a single GET/PUT. |
| **Concurrent write from two devices** | Last-writer-wins. The next sync from either device will reconcile mismatches via three-way merge. No data loss. |
| **Manifest is corrupted or truncated** | Check for valid JSON on read. If invalid, fall back to full walk + IndexedDB prevSync. |
| **ETag mismatch across S3 providers** (MinIO generates different ETags than AWS) | Manifest uses the **actual ETag from the S3 provider**. As long as the same provider is used, ETags are consistent. The manifest is per-bucket, so cross-provider issues don't arise. |
| **Encrypted files** | The manifest stores the remote ETag (of encrypted content). Decryption doesn't affect ETag comparison. |
| **Stale manifest pointing to deleted objects** | The bounded scan detects deletions. If objects were deleted without updating the manifest, the scan finds them missing and triggers remote deletions. |
| **Bandwidth cost of writing manifest** | 1 PUT per sync cycle. A 500KB manifest costs ~$0.000005 in AWS S3 PUT+storage. Negligible. |
| **Bandwidth cost of reading manifest** | 1 GET per sync cycle + 1 ListObjectsV2 (200-1000 keys). Comparable to the existing full walk but much cheaper for large buckets. |

---

## 6. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Sync start latency (10K files, no changes) | 30–60s (full walk) | <3s (1 GET + 1 ListV2) |
| Multi-device first sync | Full resync or blocked | Diff-based, only new changes |
| IndexedDB loss recovery | Full resync required | Recover from manifest immediately |
| API calls per sync (no changes) | N (full paginated list) | 2-3 (1 GET manifest + 1-2 ListV2) |
| Multi-device setup friction | High (each device syncs all files) | Zero (manifest pre-populated) |

---

## 7. Open Questions

1. **Should the manifest be per-vault or shared across vaults?** Per-vault (keyed by `vaultRandomID`). Multiple vaults in the same bucket don't interfere.

2. **Should we stop writing prevSync to IndexedDB for S3 users?** Eventually yes. During the transition, write to both (manifest + IndexedDB) and prefer manifest on read. After Phase 3, drop IndexedDB prevSync for S3.

3. **Should we compress the manifest?** For <10K files, JSON text is fine. For larger vaults, add gzip compression with `Content-Encoding: gzip`.

4. **How to handle the folder prefix (`remotePrefix`)?** The manifest path should be relative to the prefix: `_rs_state/<vaultID>/manifest.json` lives **under** the prefix, same as all other synced files.

5. **Should we expose manifest write as a setting?** Not necessary. Manifest is always-on for S3 in Phase 1. A toggle can be added if users object to the extra object in their bucket.

---

## 8. Appendix: Manifest Example

```json
{
  "version": 1,
  "vaultRandomID": "abc123def456",
  "syncedAt": 1716153600000,
  "syncId": "sync-1716153600000",
  "files": {
    "Notes/meeting.md": {
      "etag": "\"a1b2c3d4e5f6\"",
      "mtime": 1716153000000,
      "size": 2048,
      "encrypted": false
    },
    "Journal/2026-05-20.md": {
      "etag": "\"f6e5d4c3b2a1\"",
      "mtime": 1716152800000,
      "size": 1024,
      "encrypted": false
    }
  },
  "summary": {
    "fileCount": 2,
    "newestMtime": 1716153000000
  }
}
```
