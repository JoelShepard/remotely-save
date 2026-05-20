# PDR — S3 Sync Optimization for Remote Sync

> **Product Definition Requirement**  
> Date: 2026-05-20  
> Status: Draft  
> Author: AI-assisted analysis

---

## 1. Executive Summary

The plugin's sync engine was designed as a backend-agnostic three-way merger (local ↔ prevSync ↔ remote). This works well for WebDAV (a hierarchical filesystem) but has significant friction when used with S3, a flat key-value store. This document identifies six concrete problems and proposes their solutions.

---

## 2. Problem Analysis

### Problem 1 — Profile-ID isolation on backend switch

**Root cause:** `getCurrProfileID()` in `main.ts:829` returns:

```typescript
return `${this.settings.serviceType}-default-1`;
//                      ↑                  ↑
//               "s3-default-1"       or   "webdav-default-1"
```

PrevSync records in IndexedDB are stored under the composite key:

```
{vaultRandomID}\t{profileID}\t{fileKey}
```

When the user switches from WebDAV to S3, the profileID changes from `webdav-default-1` to `s3-default-1`. The old prevSync records become invisible. The sync engine sees every local file as brand new (`hasLocal && !hasRemote && !hasPrev`), producing 100% "change" → the protectModifyPercentage safety net blocks the sync.

**Impact:** Users cannot migrate between backends (or re-create a bucket) without manually clearing settings or setting protectModifyPercentage to 100%, which removes safety.

### Problem 2 — No bulk delete operations

**Root cause:** `doActualSync()` in `syncEngine.ts` deletes each remote file with an individual `fsEncrypt.rm()` call, which translates to one `DeleteObjectCommand` per key. S3 supports `DeleteObjects` (batch delete up to 1000 keys in a single request).

**Impact:** Deleting N files requires N HTTP round-trips instead of ceil(N/1000).

### Problem 3 — N+1 HeadObject calls when useAccurateMTime is on

**Root cause:** In `FakeFsS3._walkFromRoot()`, when `useAccurateMTime` is true, the code issues one `HeadObjectCommand` per listed object to read the `MTime` metadata. These are done concurrently via `PQueue`, but each is a separate HTTP request.

**Impact:** Listing 1000 files produces 1001 API calls (1 ListObjectsV2 + 1000 HeadObject). This is slow and expensive on pay-per-request S3 providers.

### Problem 4 — No server-side copy for S3

**Root cause:** The `copyFileOrFolder()` in `copyLogic.ts` always reads the full file into memory on the source side, then writes it to the destination. When both source and destination are S3 (or when the encrypted wrapper delegates to S3 for both read and write), this downloads and re-uploads data that could be server-side copied via `CopyObjectCommand`.

**Impact:** For non-encrypted syncs or for metadata-only copies, 200% of the data is transferred through the client unnecessarily.

### Problem 5 — No remote-to-remote comparison shortcut

**Root cause:** The sync engine always walks the remote (S3 ListObjectsV2) and walks the local (Obsidian vault scan), then compares every file. When the remote has thousands of objects and nothing has changed, this is wasted work.

S3's ETag provides a content hash that could be used for quick equality checks without reading file content. Currently, ETags are stored but not compared in `entityEquals()`.

**Impact:** Each sync cycle does a full list + comparison even when nothing changed.

### Problem 6 — protectModifyPercentage can't distinguish migration from data loss

**Root cause:** The safety net counts files where `change === true` and divides by total files. When switching to a new/empty backend, all files are "changed" (100%). The user sees the same error message as they would if someone deleted their S3 bucket.

**Impact:** Users must manually disable a safety feature to perform a legitimate first-time sync, reducing trust in the protection mechanism.

---

## 3. Proposed Solutions

### 3.1 Solution A — Profile‑agnostic prevSync fallback

**Goal:** When a profileID has no prevSync records, fall back to searching for records of the **same vault but any profile**. This allows backend switching without data loss.

**Implementation:**

1. Add a function in `localdb.ts`:

```typescript
export async function getPrevSyncRecordsByVaultAnyProfile(
  db: InternalDBs,
  vaultRandomID: string
): Promise<{ profileID: string; entities: Entity[] } | null> {
  const all: Entity[] = [];
  let foundProfile = "";
  const kv = await db.prevSyncRecordsTbl.getItems();
  for (const key of Object.getOwnPropertyNames(kv)) {
    if (key.startsWith(`${vaultRandomID}\t`)) {
      const parts = key.split("\t");
      if (parts.length >= 3) {
        const profile = parts[1];
        if (foundProfile === "") foundProfile = profile;
        const val = kv[key];
        if (val !== null) all.push(val);
      }
    }
  }
  return foundProfile ? { profileID: foundProfile, entities: all } : null;
}
```

2. Modify `syncRun()` in `main.ts` — if `getAllPrevSyncRecordsByVaultAndProfile()` returns empty, call the fallback above, log a warning like `"no prevSync for profile '{profileID}', falling back to '{foundProfile}' records"`, and use those records for the comparison.

3. After a successful sync with the new profile, the new prevSync records will be established under the new profileID. The old ones remain as a safety copy.

4. **Optional enhancement:** Show a notice to the user: *"Detected a switch from WebDAV to S3. 172 files found previously synced under the old backend. Continue?"*

### 3.2 Solution B — S3 bulk delete

**Goal:** Batch remote deletes into groups of up to 1000 keys per API call.

**Implementation:**

1. Add a method to `FakeFsS3`:

```typescript
async rmBatch(keys: string[]): Promise<void> {
  while (keys.length > 0) {
    const batch = keys.splice(0, 1000);
    await this.s3Client.send(new DeleteObjectsCommand({
      Bucket: this.s3Config.s3BucketName,
      Delete: { Objects: batch.map(k => ({ Key: k })), Quiet: true },
    }));
  }
}
```

2. Add `abstract rmBatch(keys: string[]): Promise<void>` to `FakeFs` base class with a default implementation that loops `rm()` per key (for WebDAV/Mock).

3. In `FakeFsEncrypt`, delegate `rmBatch` to the inner FS with encrypted keys.

4. Modify `doActualSync()` in `syncEngine.ts` to call `rmBatch()` when there are multiple remote deletions instead of queuing individual `rm()` calls.

**Performance gain:** For 172 files, from 172 HTTP requests → 1.

### 3.3 Solution C — Optional metadata-only listing

**Goal:** Eliminate the N+1 HeadObject calls.

**Implementation:**

1. Deprecate or auto-detect `useAccurateMTime`. By default, S3's `LastModified` timestamp (already returned by `ListObjectsV2`) is accurate enough for sync decisions.

2. When `useAccurateMTime` is needed, change the strategy: instead of N concurrent HeadObject calls, make a single `ListObjectsV2` with the same prefix but **with metadata** — S3 returns metadata only on individual `GET/HEAD`, but you can work around this by:

   - Store mtime in the **S3 object tags** instead of metadata (tags are returned in `ListObjectsV2` when using `list-objects-v2` optional parameter).
   - Or, add a **manifest file** (e.g., `_remote_sync_manifest.json`) that stores all mtime/ctime values for the entire bucket/prefix. Update it after each sync cycle. Read it once during walk.

3. **Recommended approach (simplest):**
   - By default, use `LastModified` from `ListObjectsV2` directly — no extra calls.
   - Store custom mtime as S3 **user metadata** on upload (already done in `_writeFileFromRoot`).
   - If `useAccurateMTime` is true, add a **cached manifest** approach: after listing, do a single GET on `_rs_meta/${vaultRandomID}.json` that contains mtime records, instead of N HeadObject calls.

### 3.4 Solution D — S3 server-side copy

**Goal:** Use `CopyObjectCommand` when the source and destination are the same S3 bucket.

**Implementation:**

1. Add a method to `FakeFsS3`:

```typescript
async copyToSameBucket(sourceKey: string, destKey: string): Promise<Entity> {
  const result = await this.s3Client.send(new CopyObjectCommand({
    Bucket: this.s3Config.s3BucketName,
    CopySource: `/${this.s3Config.s3BucketName}/${sourceKey}`,
    Key: destKey,
    MetadataDirective: "COPY",
  }));
  // return the new entity with mtime from source
}
```

2. In `FakeFsEncrypt`, detect if both source and destination FS are the same S3 instance and use `copyToSameBucket` instead of read+write.

3. In `copyLogic.ts`, add a fast path: if the source FS supports `copyTo` and the destination FS is the same instance, delegate.

**Note:** Encryption complicates this — server-side copy only works when both source and destination objects are unencrypted or use SSE-S3 with the same key. When encryption is enabled (`FakeFsEncrypt`), files are encrypted per-key, so the round-trip through the client is unavoidable. The optimization only applies when `password === ""`.

### 3.5 Solution E — ETag-based change detection

**Goal:** Skip redundant comparisons when S3 ETags match.

**Implementation:**

1. In `entityEquals()` (`syncEngine.ts:80`), add ETag comparison:

```typescript
function entityEquals(a: Entity | undefined, b: Entity | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  // If both have ETags and they match, consider equal regardless of mtime/size
  if (a.etag && b.etag && a.etag === b.etag) return true;
  const mtimeA = a.mtimeCli ?? a.mtimeSvr ?? 0;
  const mtimeB = b.mtimeCli ?? b.mtimeSvr ?? 0;
  const sizeA = a.size ?? a.sizeRaw ?? 0;
  const sizeB = b.size ?? b.sizeRaw ?? 0;
  return mtimeA === mtimeB && sizeA === sizeB;
}
```

2. Store the S3 ETag in the prevSync record (already done — `Entity.etag` exists and is populated from `_Object.ETag`).

### 3.6 Solution F — "First sync" detection & suppress protection

**Goal:** Auto-detect when the user is doing a legitimate first sync to a new/empty backend, and skip the protectModifyPercentage check.

**Implementation:**

1. Add a heuristic in `doActualSync()`:

```typescript
// If there are NO prevSync records for ANY profile (or the current profile),
// AND the remote is empty/very sparse,
// AND local has files → this is a first-time sync, skip the protection.
const isFirstSync = prevSyncEntities.length === 0 && remoteEntities.length === 0 && localEntities.length > 50;
```

2. When `isFirstSync` is true, log: *"detected first-time sync to empty remote, bypassing protectModifyPercentage"* and skip the percentage check.

3. Alternatively (more explicit): Add a **"Reset sync state"** command in the settings that clears prevSync records and shows a confirmation dialog: *"This will mark all local files as new for the next sync. Continue?"*. This gives the user an intentional way to restart from scratch without disabling the protection globally.

---

## 4. Implementation Roadmap

### Phase 1 — Quick wins (1–2 hours each)

| # | Task | Effort | Risk |
|---|------|--------|------|
| 1A | Fallback prevSync search across profiles | 2h | Low — only affects the "no prevSync found" path |
| 3E | ETag-based equality in `entityEquals()` | 30min | Low — pure logic addition |
| 3A | Auto-detect first sync and bypass protectModifyPercentage | 1h | Medium — heuristics could theoretically mask real data loss |

### Phase 2 — Performance (2–4 hours each)

| # | Task | Effort | Risk |
|---|------|--------|------|
| 2B | `rmBatch()` in S3 adapter + `FakeFs` base class | 3h | Medium — changes the abstract base class |
| 3C | Manifest-based mtime cache or metadata optimization | 4h | Medium — new file format on remote |
| 3D | S3 server-side copy optimization | 3h | Low — only activates when both FS are the same S3 |

### Phase 3 — Polish (1–2 hours)

| # | Task | Effort | Risk |
|---|------|--------|------|
| 3B | UI: "Reset sync state" command in settings | 2h | Low — just clears DB records with confirmation |
| 3A | UI: Notice when backend switch is detected | 1h | Low — informational only |

---

## 5. Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **ETag mismatch across S3 providers** — Some providers (MinIO, Ceph) may generate different ETags for the same content. | Fall back to mtime+size comparison if one side lacks an ETag. ETag is never the sole decision factor — only a shortcut for "definitely equal". |
| **Server-side copy with encryption** — When FakeFsEncrypt is active, files are encrypted per-key. CopyObject would copy the ciphertext, not re-encrypt. | Only activate server-side copy when `password === ""` (no encryption). |
| **Bulk delete partial failure** — DeleteObjects can succeed for some keys and fail for others. | Check the `Errors` array in the response and retry failed keys individually. |
| **First-sync auto-detection heuristic** — If remote has real data AND prevSync is empty, the heuristic might incorrectly bypass protection. | Only trigger when remote is **empty** (0 objects) AND local has files. If remote has any objects, the normal protection applies. |

---

## 6. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Backend switch (172 files) | Blocked — user must change setting | Smooth — one-click or automatic |
| Delete 1000 remote files | 1000 HTTP requests | 1 HTTP request |
| List 1000 files with accurate mtime | 1001 HTTP requests | 2 HTTP requests (1 list + 1 manifest GET) |
| First sync of 172 files to new S3 bucket | Blocked by protectModifyPercentage | Automatically detected and allowed |
| Sync cycle when nothing changed | Full walk + comparison + 0 transfers | Full walk + ETag shortcut + 0 transfers |

---

## 7. Open Questions

1. **Should we change `getCurrProfileID()` to exclude `serviceType`?** This would fix the backend-switch issue permanently, but it means prevSync records don't distinguish between backends. If a user has files synced to both S3 and WebDAV simultaneously, they'd conflict. Current architecture assumes one backend at a time, so this is probably safe.

2. **Should the manifest file be per-vault or per-bucket?** Per-vault (keyed by `vaultRandomID`) allows multiple Obsidian vaults to share the same S3 bucket without stepping on each other.

3. **Should the "Reset sync state" function also delete remote objects?** No — reset should only clear local sync metadata. A separate "clean remote" function could be added later.
