import localforage from "localforage";
import { extendPrototype as ep1 } from "localforage-getitems";
import { extendPrototype as ep2 } from "localforage-removeitems";
ep1(localforage);
ep2(localforage);
export type LocalForage = typeof localforage;
import { nanoid } from "nanoid";

import type { Entity, SUPPORTED_SERVICES_TYPE } from "./baseTypes";
import { unixTimeToStr } from "./misc";
import type { SyncPlanType } from "./syncEngine";

const DB_VERSION_NUMBER_IN_HISTORY = [20211114, 20220108, 20220326, 20240220];
export const DEFAULT_DB_VERSION_NUMBER: number = 20240220;
export const DEFAULT_DB_NAME = "remotelysavedb";
export const DEFAULT_TBL_VERSION = "schemaversion";
export const DEFAULT_SYNC_PLANS_HISTORY = "syncplanshistory";
export const DEFAULT_TBL_VAULT_RANDOM_ID_MAPPING = "vaultrandomidmapping";
export const DEFAULT_TBL_LOGGER_OUTPUT = "loggeroutput";
export const DEFAULT_TBL_SIMPLE_KV_FOR_MISC = "simplekvformisc";
export const DEFAULT_TBL_PREV_SYNC_RECORDS = "prevsyncrecords";
export const DEFAULT_TBL_PROFILER_RESULTS = "profilerresults";
export const DEFAULT_TBL_FILE_CONTENT_HISTORY = "filecontenthistory";

/**
 * @deprecated
 */
export const DEFAULT_TBL_FILE_HISTORY = "filefolderoperationhistory";
/**
 * @deprecated
 */
export const DEFAULT_TBL_SYNC_MAPPING = "syncmetadatahistory";

/**
 * @deprecated
 * But we cannot remove it. Because we want to migrate the old data.
 */
interface SyncMetaMappingRecord {
  localKey: string;
  remoteKey: string;
  localSize: number;
  remoteSize: number;
  localMtime: number;
  remoteMtime: number;
  remoteExtraKey: string;
  remoteType: SUPPORTED_SERVICES_TYPE;
  keyType: "folder" | "file";
  vaultRandomID: string;
}

interface SyncPlanRecord {
  ts: number;
  remoteType: string;
  syncPlan: string;
  vaultRandomID: string;
}

export interface InternalDBs {
  versionTbl: LocalForage;
  syncPlansTbl: LocalForage;
  vaultRandomIDMappingTbl: LocalForage;
  loggerOutputTbl: LocalForage;
  simpleKVForMiscTbl: LocalForage;
  prevSyncRecordsTbl: LocalForage;
  profilerResultsTbl: LocalForage;
  fileContentHistoryTbl: LocalForage;

  /**
   * @deprecated
   * But we cannot remove it. Because we want to migrate the old data.
   */
  fileHistoryTbl: LocalForage;

  /**
   * @deprecated
   * But we cannot remove it. Because we want to migrate the old data.
   */
  syncMappingTbl: LocalForage;
}

/**
 * TODO
 * @param syncMappings
 * @returns
 */
const fromSyncMappingsToPrevSyncRecords = (
  oldSyncMappings: SyncMetaMappingRecord[]
): Entity[] => {
  const res: Entity[] = [];
  for (const oldMapping of oldSyncMappings) {
    const newEntity: Entity = {
      key: oldMapping.localKey,
      keyEnc: oldMapping.remoteKey,
      keyRaw:
        oldMapping.remoteKey !== undefined && oldMapping.remoteKey !== ""
          ? oldMapping.remoteKey
          : oldMapping.localKey,
      mtimeCli: oldMapping.localMtime,
      mtimeSvr: oldMapping.remoteMtime,
      size: oldMapping.localSize,
      sizeEnc: oldMapping.remoteSize,
      sizeRaw:
        oldMapping.remoteKey !== undefined && oldMapping.remoteKey !== ""
          ? oldMapping.remoteSize
          : oldMapping.localSize,
      etag: oldMapping.remoteExtraKey,
    };

    res.push(newEntity);
  }
  return res;
};

/**
 *
 * @param db
 * @param vaultRandomID
 * Migrate the sync mapping record to sync Entity.
 */
const migrateDBsFrom20220326To20240220 = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string
) => {
  const oldVer = 20220326;
  const newVer = 20240220;
  console.debug(`start upgrading internal db from ${oldVer} to ${newVer}`);

  // from sync mapping to prev sync
  const syncMappings = await getAllSyncMetaMappingByVault(db, vaultRandomID);
  const prevSyncRecords = fromSyncMappingsToPrevSyncRecords(syncMappings);
  for (const prevSyncRecord of prevSyncRecords) {
    await upsertPrevSyncRecordByVaultAndProfile(
      db,
      vaultRandomID,
      profileID,
      prevSyncRecord
    );
  }

  // // clear not used data
  // // as of 20240220, we don't call them,
  // // for the opportunity for users to downgrade
  // await clearFileHistoryOfEverythingByVault(db, vaultRandomID);
  // await clearAllSyncMetaMappingByVault(db, vaultRandomID);

  await db.versionTbl.setItem(`${vaultRandomID}\tversion`, newVer);
  console.debug(`finish upgrading internal db from ${oldVer} to ${newVer}`);
};

const migrateDBs = async (
  db: InternalDBs,
  oldVer: number,
  newVer: number,
  vaultRandomID: string,
  profileID: string
) => {
  if (oldVer === newVer) {
    return;
  }

  // as of 20240220, we assume everyone is using 20220326 already
  // drop any old code to reduce the verbose
  if (oldVer < 20220326) {
    throw Error(
      "You are using a very old version of Remote Sync. No way to auto update internal DB. Please install and enable 0.3.40 firstly, then install a later version."
    );
  }

  if (oldVer === 20220326 && newVer === 20240220) {
    return await migrateDBsFrom20220326To20240220(db, vaultRandomID, profileID);
  }

  if (newVer < oldVer) {
    throw Error(
      "You've installed a new version, but then downgrade to an old version. Stop working!"
    );
  }
  // not implemented
  throw Error(`not supported internal db changes from ${oldVer} to ${newVer}`);
};

export const prepareDBs = async (
  vaultBasePath: string,
  vaultRandomIDFromOldConfigFile: string,
  profileID: string
) => {
  const db = {
    versionTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_VERSION,
    }),
    syncPlansTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_SYNC_PLANS_HISTORY,
    }),
    vaultRandomIDMappingTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_VAULT_RANDOM_ID_MAPPING,
    }),
    loggerOutputTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_LOGGER_OUTPUT,
    }),
    simpleKVForMiscTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_SIMPLE_KV_FOR_MISC,
    }),
    prevSyncRecordsTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_PREV_SYNC_RECORDS,
    }),
    profilerResultsTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_PROFILER_RESULTS,
    }),

    fileHistoryTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_FILE_HISTORY,
    }),
    syncMappingTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_SYNC_MAPPING,
    }),

    fileContentHistoryTbl: localforage.createInstance({
      name: DEFAULT_DB_NAME,
      storeName: DEFAULT_TBL_FILE_CONTENT_HISTORY,
    }),
  } as InternalDBs;

  // try to get vaultRandomID firstly
  let vaultRandomID = "";
  const vaultRandomIDInDB: string | null =
    await db.vaultRandomIDMappingTbl.getItem(`path2id\t${vaultBasePath}`);
  if (vaultRandomIDInDB === null) {
    if (vaultRandomIDFromOldConfigFile !== "") {
      // reuse the old config id
      vaultRandomID = vaultRandomIDFromOldConfigFile;
    } else {
      // no old config id, we create a random one
      vaultRandomID = nanoid();
    }
    // save the id back
    await db.vaultRandomIDMappingTbl.setItem(
      `path2id\t${vaultBasePath}`,
      vaultRandomID
    );
    await db.vaultRandomIDMappingTbl.setItem(
      `id2path\t${vaultRandomID}`,
      vaultBasePath
    );
  } else {
    vaultRandomID = vaultRandomIDInDB;
  }

  if (vaultRandomID === "") {
    throw Error("no vaultRandomID found or generated");
  }

  // as of 20240220, we set the version per vault, instead of global "version"
  const originalVersion: number | null =
    (await db.versionTbl.getItem(`${vaultRandomID}\tversion`)) ??
    (await db.versionTbl.getItem("version"));
  if (originalVersion === null) {
    console.debug(
      `no internal db version, setting it to ${DEFAULT_DB_VERSION_NUMBER}`
    );
    // as of 20240220, we set the version per vault, instead of global "version"
    await db.versionTbl.setItem(
      `${vaultRandomID}\tversion`,
      DEFAULT_DB_VERSION_NUMBER
    );
  } else if (originalVersion === DEFAULT_DB_VERSION_NUMBER) {
    // do nothing
  } else {
    console.debug(
      `trying to upgrade db version from ${originalVersion} to ${DEFAULT_DB_VERSION_NUMBER}`
    );
    await migrateDBs(
      db,
      originalVersion,
      DEFAULT_DB_VERSION_NUMBER,
      vaultRandomID,
      profileID
    );
  }

  console.info("db connected");
  return {
    db: db,
    vaultRandomID: vaultRandomID,
  };
};

export const destroyDBs = async () => {
  // await localforage.dropInstance({
  //   name: DEFAULT_DB_NAME,
  // });
  // console.info("db deleted");
  const req = indexedDB.deleteDatabase(DEFAULT_DB_NAME);
  req.onsuccess = (event) => {
    console.info("db deleted");
  };
  req.onblocked = (event) => {
    console.warn("trying to delete db but it was blocked");
  };
  req.onerror = (event) => {
    console.error("tried to delete db but something goes wrong!");
    console.error(event);
  };
};

export const clearFileHistoryOfEverythingByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const keys = (await db.fileHistoryTbl.keys()).filter((x) =>
    x.startsWith(`${vaultRandomID}\t`)
  );
  await db.fileHistoryTbl.removeItems(keys);
  // for (const key of keys) {
  //   if (key.startsWith(`${vaultRandomID}\t`)) {
  //     await db.fileHistoryTbl.removeItem(key);
  //   }
  // }
};

/**
 * @deprecated But we cannot remove it. Because we want to migrate the old data.
 * @param db
 * @param vaultRandomID
 * @returns
 */
export const getAllSyncMetaMappingByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  return await Promise.all(
    ((await db.syncMappingTbl.keys()) ?? [])
      .filter((key) => key.startsWith(`${vaultRandomID}\t`))
      .map(
        async (key) =>
          (await db.syncMappingTbl.getItem(key)) as SyncMetaMappingRecord
      )
  );
};

export const clearAllSyncMetaMappingByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const keys = (await db.syncMappingTbl.keys()).filter((x) =>
    x.startsWith(`${vaultRandomID}\t`)
  );
  await db.syncMappingTbl.removeItems(keys);
  // for (const key of keys) {
  //   if (key.startsWith(`${vaultRandomID}\t`)) {
  //     await db.syncMappingTbl.removeItem(key);
  //   }
  // }
};

export const insertSyncPlanRecordByVault = async (
  db: InternalDBs,
  syncPlan: SyncPlanType,
  vaultRandomID: string,
  remoteType: SUPPORTED_SERVICES_TYPE
) => {
  const now = Date.now();
  const record = {
    ts: now,
    tsFmt: unixTimeToStr(now),
    vaultRandomID: vaultRandomID,
    remoteType: remoteType,
    syncPlan: JSON.stringify(syncPlan /* directly stringify */, null, 2),
  } as SyncPlanRecord;
  await db.syncPlansTbl.setItem(`${vaultRandomID}\t${now}`, record);
};

export const clearAllSyncPlanRecords = async (db: InternalDBs) => {
  await db.syncPlansTbl.clear();
};

export const readAllSyncPlanRecordTextsByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const records = [] as SyncPlanRecord[];
  await db.syncPlansTbl.iterate((value, key, iterationNumber) => {
    if (key.startsWith(`${vaultRandomID}\t`)) {
      records.push(value as SyncPlanRecord);
    }
  });
  records.sort((a, b) => -(a.ts - b.ts)); // descending

  if (records === undefined) {
    return [] as string[];
  } else {
    return records.map((x) => x.syncPlan);
  }
};

/**
 * We remove records that are older than 1 days or 20 records.
 * It's a heavy operation, so we shall not place it in the start up.
 * @param db
 */
export const clearExpiredSyncPlanRecords = async (db: InternalDBs) => {
  const MILLISECONDS_OLD = 1000 * 60 * 60 * 24 * 1; // 1 days
  const COUNT_TO_MANY = 20;

  const currTs = Date.now();
  const expiredTs = currTs - MILLISECONDS_OLD;

  let records = (await db.syncPlansTbl.keys()).map((key) => {
    const ts = Number.parseInt(key.split("\t")[1]);
    const expired = ts <= expiredTs;
    return {
      ts: ts,
      key: key,
      expired: expired,
    };
  });

  const keysToRemove = new Set(
    records.filter((x) => x.expired).map((x) => x.key)
  );

  if (records.length - keysToRemove.size > COUNT_TO_MANY) {
    // we need to find out records beyond 100 records
    records = records.filter((x) => !x.expired); // shrink the array
    records.sort((a, b) => -(a.ts - b.ts)); // descending
    records.slice(COUNT_TO_MANY).forEach((element) => {
      keysToRemove.add(element.key);
    });
  }

  // const ps = [] as Promise<void>[];
  // keysToRemove.forEach((element) => {
  //   ps.push(db.syncPlansTbl.removeItem(element));
  // });
  // await Promise.all(ps);
  await db.syncPlansTbl.removeItems(Array.from(keysToRemove));
};

export const getAllPrevSyncRecordsByVaultAndProfile = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string
) => {
  const res: Entity[] = [];
  const kv: Record<string, Entity | null> =
    await db.prevSyncRecordsTbl.getItems();
  for (const key of Object.getOwnPropertyNames(kv)) {
    if (key.startsWith(`${vaultRandomID}\t${profileID}\t`)) {
      const val = kv[key];
      if (val !== null) {
        res.push(val);
      }
    }
  }
  return res;
};

export const upsertPrevSyncRecordByVaultAndProfile = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  prevSync: Entity
) => {
  await db.prevSyncRecordsTbl.setItem(
    `${vaultRandomID}\t${profileID}\t${prevSync.key}`,
    prevSync
  );
};

/**
 * Search for prevSync records from any profile when the current profile has none.
 * This allows backend switching (e.g., WebDAV → S3) without data loss.
 *
 * @returns The first profileID with records and the entities, or null if none found.
 */
export const getPrevSyncRecordsByVaultAnyProfile = async (
  db: InternalDBs,
  vaultRandomID: string
): Promise<{ profileID: string; entities: Entity[] } | null> => {
  const entitiesByProfile = new Map<string, Entity[]>();
  const kv: Record<string, Entity | null> =
    await db.prevSyncRecordsTbl.getItems();
  for (const key of Object.getOwnPropertyNames(kv)) {
    if (!key.startsWith(`${vaultRandomID}\t`)) {
      continue;
    }
    const parts = key.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const profile = parts[1];
    const val = kv[key];
    if (val === null) {
      continue;
    }
    if (!entitiesByProfile.has(profile)) {
      entitiesByProfile.set(profile, []);
    }
    entitiesByProfile.get(profile)!.push(val);
  }

  const sortedProfiles = Array.from(entitiesByProfile.keys()).sort();
  if (sortedProfiles.length === 0) {
    return null;
  }

  const profileID = sortedProfiles[0];
  return {
    profileID,
    entities: entitiesByProfile.get(profileID) ?? [],
  };
};

export const clearPrevSyncRecordByVaultAndProfile = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  key: string
) => {
  await db.prevSyncRecordsTbl.removeItem(
    `${vaultRandomID}\t${profileID}\t${key}`
  );
};

export const clearAllPrevSyncRecordByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const keys = (await db.prevSyncRecordsTbl.keys()).filter((x) =>
    x.startsWith(`${vaultRandomID}\t`)
  );
  await db.prevSyncRecordsTbl.removeItems(keys);
};

export const clearAllLoggerOutputRecords = async (db: InternalDBs) => {
  await db.loggerOutputTbl.clear();
  console.debug(`successfully clearAllLoggerOutputRecords`);
};

export const upsertLastSuccessSyncTimeByVault = async (
  db: InternalDBs,
  vaultRandomID: string,
  millis: number
) => {
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}-lastSuccessSyncMillis`,
    millis
  );
};

export const getLastSuccessSyncTimeByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  return (await db.simpleKVForMiscTbl.getItem(
    `${vaultRandomID}-lastSuccessSyncMillis`
  )) as number | null | undefined;
};

export const upsertLastFailedSyncTimeByVault = async (
  db: InternalDBs,
  vaultRandomID: string,
  millis: number
) => {
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}-lastFailedSyncMillis`,
    millis
  );
};

export const getLastFailedSyncTimeByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  return (await db.simpleKVForMiscTbl.getItem(
    `${vaultRandomID}-lastFailedSyncMillis`
  )) as number | null | undefined;
};

export const upsertPluginVersionByVault = async (
  db: InternalDBs,
  vaultRandomID: string,
  newVersion: string
) => {
  let oldVersion: string | null = await db.simpleKVForMiscTbl.getItem(
    `${vaultRandomID}-pluginversion`
  );
  if (oldVersion === null) {
    oldVersion = "0.0.0";
  }
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}-pluginversion`,
    newVersion
  );

  return {
    oldVersion: oldVersion,
    newVersion: newVersion,
  };
};

export const insertProfilerResultByVault = async (
  db: InternalDBs,
  profilerStr: string,
  vaultRandomID: string,
  remoteType: SUPPORTED_SERVICES_TYPE
) => {
  const now = Date.now();
  await db.profilerResultsTbl.setItem(`${vaultRandomID}\t${now}`, profilerStr);

  // clear older one while writing
  const records = (await db.profilerResultsTbl.keys())
    .filter((x) => x.startsWith(`${vaultRandomID}\t`))
    .map((x) => Number.parseInt(x.split("\t")[1]));
  records.sort((a, b) => -(a - b)); // descending
  while (records.length > 5) {
    const ts = records.pop()!;
    await db.profilerResultsTbl.removeItem(`${vaultRandomID}\t${ts}`);
  }
};

export const readAllProfilerResultsByVault = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const records = [] as { val: string; ts: number }[];
  await db.profilerResultsTbl.iterate((value, key, iterationNumber) => {
    if (key.startsWith(`${vaultRandomID}\t`)) {
      records.push({
        val: value as string,
        ts: Number.parseInt(key.split("\t")[1]),
      });
    }
  });
  records.sort((a, b) => -(a.ts - b.ts)); // descending

  if (records === undefined) {
    return [] as string[];
  } else {
    return records.map((x) => x.val);
  }
};

const PENDING_DELETION_KEY_PREFIX = "pending-deletion";

export const addPendingDeletion = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  key: string
) => {
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}\t${profileID}\t${PENDING_DELETION_KEY_PREFIX}\t${key}`,
    Date.now()
  );
};

export const getPendingDeletions = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string
): Promise<{ key: string; timestamp: number }[]> => {
  const prefix = `${vaultRandomID}\t${profileID}\t${PENDING_DELETION_KEY_PREFIX}\t`;
  const results: { key: string; timestamp: number }[] = [];
  await db.simpleKVForMiscTbl.iterate((value, compoundKey) => {
    if (typeof compoundKey === "string" && compoundKey.startsWith(prefix)) {
      const fileKey = compoundKey.slice(prefix.length);
      results.push({ key: fileKey, timestamp: value as number });
    }
  });
  return results;
};

export const clearPendingDeletions = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  keys: string[]
) => {
  const compoundKeys = keys.map(
    (k) =>
      `${vaultRandomID}\t${profileID}\t${PENDING_DELETION_KEY_PREFIX}\t${k}`
  );
  await db.simpleKVForMiscTbl.removeItems(compoundKeys);
};

const PENDING_OP_KEY_PREFIX = "pending-op";

export type PendingOpType = "create" | "modify" | "rename" | "delete";

export interface PendingOp {
  type: PendingOpType;
  key: string;
  newKey?: string;
  timestamp: number;
}

export const addPendingOp = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  op: PendingOp
) => {
  const entryKey = `${vaultRandomID}\t${profileID}\t${PENDING_OP_KEY_PREFIX}\t${op.type}\t${op.key}`;
  await db.simpleKVForMiscTbl.setItem(entryKey, op);
};

export const getPendingOps = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string
): Promise<PendingOp[]> => {
  const prefix = `${vaultRandomID}\t${profileID}\t${PENDING_OP_KEY_PREFIX}\t`;
  const results: PendingOp[] = [];
  await db.simpleKVForMiscTbl.iterate((value, compoundKey) => {
    if (typeof compoundKey === "string" && compoundKey.startsWith(prefix)) {
      results.push(value as PendingOp);
    }
  });
  return results;
};

export const clearPendingOps = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string
) => {
  const prefix = `${vaultRandomID}\t${profileID}\t${PENDING_OP_KEY_PREFIX}\t`;
  const keysToRemove: string[] = [];
  await db.simpleKVForMiscTbl.iterate((_value, compoundKey) => {
    if (typeof compoundKey === "string" && compoundKey.startsWith(prefix)) {
      keysToRemove.push(compoundKey);
    }
  });
  await db.simpleKVForMiscTbl.removeItems(keysToRemove);
};

// ── Error History (PRD Better Debugging) ──

export const ERROR_HISTORY_KEY_PREFIX = "error-history";
const MAX_ERROR_RECORDS = 50;

export interface ErrorHistoryRecord {
  timestamp: number;
  category: string;
  message: string;
  syncId?: string;
  recovered?: boolean;
}

export const addErrorRecord = async (
  db: InternalDBs,
  vaultRandomID: string,
  record: ErrorHistoryRecord
) => {
  const key = `${vaultRandomID}	${ERROR_HISTORY_KEY_PREFIX}	${record.timestamp}`;
  await db.simpleKVForMiscTbl.setItem(key, record);

  // Prune old records
  const keys: string[] = [];
  await db.simpleKVForMiscTbl.iterate((_value, compoundKey) => {
    if (
      typeof compoundKey === "string" &&
      compoundKey.startsWith(`${vaultRandomID}	${ERROR_HISTORY_KEY_PREFIX}`)
    ) {
      keys.push(compoundKey);
    }
  });
  keys.sort();
  while (keys.length > MAX_ERROR_RECORDS) {
    const oldKey = keys.shift()!;
    await db.simpleKVForMiscTbl.removeItem(oldKey);
  }
};

export const getErrorRecords = async (
  db: InternalDBs,
  vaultRandomID: string
): Promise<ErrorHistoryRecord[]> => {
  const results: ErrorHistoryRecord[] = [];
  await db.simpleKVForMiscTbl.iterate((value, compoundKey) => {
    if (
      typeof compoundKey === "string" &&
      compoundKey.startsWith(`${vaultRandomID}	${ERROR_HISTORY_KEY_PREFIX}`)
    ) {
      results.push(value as ErrorHistoryRecord);
    }
  });
  results.sort((a, b) => b.timestamp - a.timestamp); // newest first
  return results;
};

export const clearErrorRecords = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const keys: string[] = [];
  await db.simpleKVForMiscTbl.iterate((_value, compoundKey) => {
    if (
      typeof compoundKey === "string" &&
      compoundKey.startsWith(`${vaultRandomID}	${ERROR_HISTORY_KEY_PREFIX}`)
    ) {
      keys.push(compoundKey);
    }
  });
  await db.simpleKVForMiscTbl.removeItems(keys);
};

export const markErrorRecovered = async (
  db: InternalDBs,
  vaultRandomID: string,
  syncId: string
) => {
  const errors = await getErrorRecords(db, vaultRandomID);
  for (const err of errors) {
    if (err.syncId === syncId) {
      err.recovered = true;
      const key = `${vaultRandomID}	${ERROR_HISTORY_KEY_PREFIX}	${err.timestamp}`;
      await db.simpleKVForMiscTbl.setItem(key, err);
    }
  }
};

// ── Sync Checkpoint (PRD Sync Behavior Rework §3.4) ──

const CHECKPOINT_KEY_PREFIX = "sync-checkpoint";

export interface SyncCheckpoint {
  syncId: string;
  vaultRandomID: string;
  profileID: string;
  startedAt: number;
  totalOps: number;
  completedOps: number;
  lastCompletedKey: string;
  status: "in_progress" | "completed" | "failed";
  errorMessage?: string;
}

export const saveSyncCheckpoint = async (
  db: InternalDBs,
  checkpoint: SyncCheckpoint
) => {
  const key = `${checkpoint.vaultRandomID}\t${CHECKPOINT_KEY_PREFIX}`;
  await db.simpleKVForMiscTbl.setItem(key, checkpoint);
};

export const getSyncCheckpoint = async (
  db: InternalDBs,
  vaultRandomID: string
): Promise<SyncCheckpoint | null> => {
  const key = `${vaultRandomID}\t${CHECKPOINT_KEY_PREFIX}`;
  return (await db.simpleKVForMiscTbl.getItem(key)) as SyncCheckpoint | null;
};

export const clearSyncCheckpoint = async (
  db: InternalDBs,
  vaultRandomID: string
) => {
  const key = `${vaultRandomID}\t${CHECKPOINT_KEY_PREFIX}`;
  await db.simpleKVForMiscTbl.removeItem(key);
};

/**
 * Merge a new pending op with existing ones for the same key.
 * Applies the deduplication rules from PDR-sync-behavior-rework §5.2.
 *
 * Rules:
 *   create + modify  → keep create (subsumes modify)
 *   create + delete  → remove both (net no-op)
 *   create + rename  → change create key to new key
 *   modify + modify  → keep only newest
 *   modify + delete  → change to delete
 *   modify + rename  → keep rename (subsumes modify)
 *   delete + create  → change to modify
 *   delete + modify  → keep modify (file recreated)
 *   rename + modify (on newKey) → keep rename, skip modify
 *   rename + delete (on old key) → ignore delete
 *   rename + delete (on new key) → remove both (file renamed then deleted)
 *   rename + rename  → update newKey
 */
export const mergeAndAddPendingOp = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  newOp: PendingOp
) => {
  // Load existing ops for the same file key
  const allOps = await getPendingOps(db, vaultRandomID, profileID);
  const existingForKey = allOps.filter((op) => op.key === newOp.key);

  // For rename ops, also check if the newKey matches (rename then modify on target)
  const renameForNewKey = allOps.filter(
    (op) => op.type === "rename" && op.newKey === newOp.key
  );

  // ── Special: rename + modify on newKey, rename + delete on newKey ──
  if (existingForKey.length === 0 && renameForNewKey.length > 0) {
    if (newOp.type === "modify") {
      // File was renamed, then modified at new location
      // Rename already implies the new file exists → keep rename, skip modify
      return;
    }
    if (newOp.type === "delete") {
      // File was renamed to newKey, then deleted at newKey
      // Net: file renamed then deleted at destination → remove rename (net no-op)
      await clearPendingOpsByKey(
        db,
        vaultRandomID,
        profileID,
        newOp.key,
        "rename"
      );
      return;
    }
  }

  if (existingForKey.length === 0) {
    // No existing ops for this key, just add
    await addPendingOp(db, vaultRandomID, profileID, newOp);
    return;
  }

  // Apply merge rules for each existing op type
  for (const existing of existingForKey) {
    const pair = `${existing.type} + ${newOp.type}`;

    switch (pair) {
      case "create + modify":
        // Keep create (subsumes modify) — update timestamp
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "modify"
        );
        existing.timestamp = newOp.timestamp;
        await addPendingOp(db, vaultRandomID, profileID, existing);
        return;

      case "create + delete":
        // Remove both (net no-op)
        await clearPendingOpsByKey(db, vaultRandomID, profileID, newOp.key);
        return;

      case "create + rename":
        // Change create key to new key (file was created then renamed)
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "create"
        );
        newOp.type = "create";
        newOp.key = newOp.newKey!;
        delete newOp.newKey;
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "modify + modify":
        // Keep only newest
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "modify"
        );
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "modify + delete":
        // Change to delete
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "modify"
        );
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "modify + rename":
        // Keep rename (subsumes modify)
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "modify"
        );
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "delete + create":
        // File deleted then recreated → becomes modify
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "delete"
        );
        newOp.type = "modify";
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "delete + modify":
        // File deleted then modified → becomes modify
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "delete"
        );
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "rename + rename":
        // Update newKey and timestamp
        existing.newKey = newOp.newKey!;
        existing.timestamp = newOp.timestamp;
        await clearPendingOpsByKey(
          db,
          vaultRandomID,
          profileID,
          newOp.key,
          "rename"
        );
        await addPendingOp(db, vaultRandomID, profileID, existing);
        return;

      case "rename + modify":
        if (newOp.key === existing.newKey) {
          // Modify is on the rename target — keep rename, skip modify
          return;
        }
        // Modify is on a different path — add alongside
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      case "rename + delete":
        if (newOp.key === existing.key) {
          // Delete is on the old (pre-rename) key — ignore
          return;
        }
        if (newOp.key === existing.newKey) {
          // File was renamed to newKey, then deleted at newKey
          // Net: remove both
          await clearPendingOpsByKey(
            db,
            vaultRandomID,
            profileID,
            existing.key,
            "rename"
          );
          return;
        }
        // Delete is on a different path — add alongside
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;

      default:
        // No special rule, just add alongside existing
        await addPendingOp(db, vaultRandomID, profileID, newOp);
        return;
    }
  }

  // Fallback
  await addPendingOp(db, vaultRandomID, profileID, newOp);
};

export const clearPendingOpsByKey = async (
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string,
  key: string,
  type?: PendingOpType
) => {
  const prefix = `${vaultRandomID}\t${profileID}\t${PENDING_OP_KEY_PREFIX}\t`;
  const keysToRemove: string[] = [];
  await db.simpleKVForMiscTbl.iterate((_value, compoundKey) => {
    if (typeof compoundKey === "string" && compoundKey.startsWith(prefix)) {
      const suffix = compoundKey.slice(prefix.length);
      const parts = suffix.split("\t");
      const opType = parts[0];
      if (type !== undefined && opType !== type) return;
      if (parts[1] === key) {
        keysToRemove.push(compoundKey);
      }
    }
  });
  await db.simpleKVForMiscTbl.removeItems(keysToRemove);
};
