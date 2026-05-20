import { strict as assert } from "assert";
import "fake-indexeddb/auto";

import {
  type InternalDBs,
  clearSyncCheckpoint,
  getPrevSyncRecordsByVaultAnyProfile,
  getSyncCheckpoint,
  prepareDBs,
  saveSyncCheckpoint,
} from "../src/localdb";
import type { SyncCheckpoint } from "../src/localdb";

if (typeof globalThis.self === "undefined") {
  (globalThis as any).self = globalThis;
}

describe("localdb: checkpoint system", () => {
  let db: InternalDBs;
  const vaultRandomID = "test-vault-123";
  const profileID = "s3-default-1";

  before(async () => {
    // Prepare the DBs with a unique name to avoid cross-test conflicts
    const result = await prepareDBs(
      "/tmp/test-checkpoint-vault",
      "",
      profileID
    );
    db = result.db;
  });

  after(async () => {
    // Clean up
    if (db.simpleKVForMiscTbl) {
      await db.simpleKVForMiscTbl.clear();
    }
  });

  beforeEach(async () => {
    // Clear checkpoint before each test
    try {
      await clearSyncCheckpoint(db, vaultRandomID);
    } catch {
      // ignore
    }
  });

  it("should save and retrieve a checkpoint", async () => {
    const cp: SyncCheckpoint = {
      syncId: "sync-1",
      vaultRandomID,
      profileID,
      startedAt: 1000,
      totalOps: 10,
      completedOps: 0,
      lastCompletedKey: "",
      status: "in_progress",
    };

    await saveSyncCheckpoint(db, cp);

    const retrieved = await getSyncCheckpoint(db, vaultRandomID);
    assert.ok(retrieved !== null);
    assert.equal(retrieved!.syncId, "sync-1");
    assert.equal(retrieved!.status, "in_progress");
    assert.equal(retrieved!.totalOps, 10);
    assert.equal(retrieved!.completedOps, 0);
  });

  it("should clear a checkpoint", async () => {
    const cp: SyncCheckpoint = {
      syncId: "sync-2",
      vaultRandomID,
      profileID,
      startedAt: 2000,
      totalOps: 5,
      completedOps: 3,
      lastCompletedKey: "file3.md",
      status: "in_progress",
    };

    await saveSyncCheckpoint(db, cp);
    assert.ok((await getSyncCheckpoint(db, vaultRandomID)) !== null);

    await clearSyncCheckpoint(db, vaultRandomID);
    assert.equal(await getSyncCheckpoint(db, vaultRandomID), null);
  });

  it("should update an existing checkpoint", async () => {
    const cp: SyncCheckpoint = {
      syncId: "sync-3",
      vaultRandomID,
      profileID,
      startedAt: 3000,
      totalOps: 10,
      completedOps: 5,
      lastCompletedKey: "half.md",
      status: "in_progress",
    };

    await saveSyncCheckpoint(db, cp);

    // Update progress
    cp.completedOps = 8;
    cp.lastCompletedKey = "eight.md";
    await saveSyncCheckpoint(db, cp);

    const retrieved = await getSyncCheckpoint(db, vaultRandomID);
    assert.equal(retrieved!.completedOps, 8);
    assert.equal(retrieved!.lastCompletedKey, "eight.md");
  });

  it("should return null when no checkpoint exists", async () => {
    const result = await getSyncCheckpoint(db, `nonexistent-${vaultRandomID}`);
    assert.equal(result, null);
  });
});

describe("localdb: getPrevSyncRecordsByVaultAnyProfile", () => {
  let db: InternalDBs;
  const vaultRandomID = "test-vault-for-fallback";
  const profileS3 = "s3-default-1";
  const profileWebdav = "webdav-default-1";

  before(async () => {
    const result = await prepareDBs("/tmp/test-fallback-vault", "", profileS3);
    db = result.db;
  });

  after(async () => {
    if (db.prevSyncRecordsTbl) {
      await db.prevSyncRecordsTbl.clear();
    }
    if (db.simpleKVForMiscTbl) {
      await db.simpleKVForMiscTbl.clear();
    }
  });

  beforeEach(async () => {
    // Clean prevSync records before each test
    if (db.prevSyncRecordsTbl) {
      await db.prevSyncRecordsTbl.clear();
    }
  });

  it("should return null when no prevSync records exist", async () => {
    const result = await getPrevSyncRecordsByVaultAnyProfile(db, vaultRandomID);
    assert.equal(result, null);
  });

  it("should find records from another profile", async () => {
    // Insert prevSync records under webdav profile
    await db.prevSyncRecordsTbl.setItem(
      `${vaultRandomID}\t${profileWebdav}\ta.md`,
      {
        key: "a.md",
        keyRaw: "a.md",
        sizeRaw: 100,
        mtimeCli: 1000,
      }
    );
    await db.prevSyncRecordsTbl.setItem(
      `${vaultRandomID}\t${profileWebdav}\tb.md`,
      {
        key: "b.md",
        keyRaw: "b.md",
        sizeRaw: 200,
        mtimeCli: 2000,
      }
    );

    // Now query with a different profile (S3)
    const result = await getPrevSyncRecordsByVaultAnyProfile(db, vaultRandomID);

    assert.ok(result !== null);
    assert.equal(result!.profileID, profileWebdav);
    assert.equal(result!.entities.length, 2);
  });

  it("should return records from only one profile when both profiles exist", async () => {
    await db.prevSyncRecordsTbl.setItem(
      `${vaultRandomID}\t${profileS3}\tc.md`,
      {
        key: "c.md",
        keyRaw: "c.md",
        sizeRaw: 300,
        mtimeCli: 3000,
      }
    );
    await db.prevSyncRecordsTbl.setItem(
      `${vaultRandomID}\t${profileWebdav}\td.md`,
      {
        key: "d.md",
        keyRaw: "d.md",
        sizeRaw: 400,
        mtimeCli: 4000,
      }
    );

    const result = await getPrevSyncRecordsByVaultAnyProfile(db, vaultRandomID);

    assert.ok(result !== null);
    assert.equal(result!.profileID, profileS3);
    assert.equal(result!.entities.length, 1);
    assert.equal(result!.entities[0].key, "c.md");
  });

  it("should not find records for a different vault", async () => {
    await db.prevSyncRecordsTbl.setItem(
      `${vaultRandomID}\t${profileS3}\te.md`,
      {
        key: "e.md",
        keyRaw: "e.md",
        sizeRaw: 500,
        mtimeCli: 5000,
      }
    );

    // Query with a different vault ID
    const result = await getPrevSyncRecordsByVaultAnyProfile(
      db,
      "different-vault-id"
    );
    assert.equal(result, null);
  });
});
