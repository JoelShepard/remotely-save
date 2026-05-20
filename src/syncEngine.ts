// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
import AggregateError from "aggregate-error";
import { nanoid } from "nanoid";
import PQueue from "p-queue";
import type {
  ConflictActionType,
  DecisionTypeForMixedEntity,
  Entity,
  ManifestEntry,
  MixedEntity,
  RemoteManifest,
  RemotelySavePluginSettings,
  SUPPORTED_SERVICES_TYPE,
  SyncDirectionType,
  SyncTriggerSourceType,
} from "./baseTypes";
import { copyFile, copyFileOrFolder, copyFolder } from "./copyLogic";
import type {
  FakeFs,
  LocalChangeStat,
  RemoteManifestStat,
  RemoteSnapshot,
} from "./fsAll";
import type { FakeFsEncrypt } from "./fsEncrypt";
import {
  type InternalDBs,
  type PendingOp,
  clearPendingOps,
  clearPrevSyncRecordByVaultAndProfile,
  clearSyncCheckpoint,
  getAllPrevSyncRecordsByVaultAndProfile,
  getPendingOps,
  getPrevSyncRecordsByVaultAnyProfile,
  getSyncCheckpoint,
  insertSyncPlanRecordByVault,
  saveSyncCheckpoint,
  upsertPrevSyncRecordByVaultAndProfile,
} from "./localdb";
import {
  atWhichLevel,
  checkValidName,
  getFolderLevels,
  getParentFolder,
  isHiddenPath,
  isSpecialFolderNameToSkip,
  roughSizeOfObject,
  unixTimeToStr,
} from "./misc";
import type { Profiler } from "./profiler";

export type SyncPlanType = Record<string, MixedEntity>;

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function entityMtimeCli(e: Entity | undefined): number {
  if (e === undefined) return 0;
  return e.mtimeCli ?? 0;
}

function entitySizeBytes(e: Entity | undefined): number {
  if (e === undefined) return 0;
  return e.size ?? e.sizeRaw ?? 0;
}

function isFolderKey(key: string): boolean {
  return key.endsWith("/");
}

export function entityEquals(
  a: Entity | undefined,
  b: Entity | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  // If both have matching ETags, consider equal regardless of mtime/size
  if (a.etag && b.etag && a.etag === b.etag) return true;
  // Round mtimes to seconds for comparison because:
  // - S3 LastModified operates at second precision
  // - File system mtimes may have millisecond precision
  // - Without rounding, a file uploaded from S3 (second-precise mtime)
  //   would never match its local source (millisecond-precise mtime)
  const mtimeA = Math.floor((a.mtimeCli ?? a.mtimeSvr ?? 0) / 1000) * 1000;
  const mtimeB = Math.floor((b.mtimeCli ?? b.mtimeSvr ?? 0) / 1000) * 1000;
  const sizeA = a.size ?? a.sizeRaw ?? 0;
  const sizeB = b.size ?? b.sizeRaw ?? 0;
  return mtimeA === mtimeB && sizeA === sizeB;
}

function shouldSkipPath(
  key: string,
  syncConfigDir: boolean,
  syncBookmarks: boolean,
  configDir: string,
  syncUnderscoreItems: boolean,
  ignorePaths: string[],
  onlyAllowPaths: string[]
): boolean {
  if (isHiddenPath(key, true, !syncUnderscoreItems)) return true;

  if (!syncConfigDir && configDir !== "" && key.startsWith(configDir)) {
    return true;
  }

  if (isSpecialFolderNameToSkip(key, undefined)) return true;

  for (const p of ignorePaths) {
    if (p === "") continue;
    if (key.startsWith(p)) return true;
  }

  if (onlyAllowPaths.length > 0) {
    for (const p of onlyAllowPaths) {
      if (p === "") continue;
      if (key.startsWith(p)) return false;
    }
    return true;
  }

  return false;
}

function buildMixedEntityMap(
  localEntities: Entity[],
  prevSyncEntities: Entity[],
  remoteEntities: Entity[]
): Record<string, MixedEntity> {
  const allKeys = new Set<string>();
  for (const e of localEntities) allKeys.add(e.keyRaw);
  for (const e of prevSyncEntities) allKeys.add(e.keyRaw);
  for (const e of remoteEntities) allKeys.add(e.keyRaw);

  const localMap = new Map<string, Entity>();
  for (const e of localEntities) localMap.set(e.keyRaw, e);
  const prevSyncMap = new Map<string, Entity>();
  for (const e of prevSyncEntities) prevSyncMap.set(e.keyRaw, e);
  const remoteMap = new Map<string, Entity>();
  for (const e of remoteEntities) remoteMap.set(e.keyRaw, e);

  const result: Record<string, MixedEntity> = {};
  for (const key of allKeys) {
    const m: MixedEntity = {
      key,
      local: localMap.get(key),
      prevSync: prevSyncMap.get(key),
      remote: remoteMap.get(key),
    };
    result[key] = m;
  }
  return result;
}

function decideDeletionDirection(syncDirection: SyncDirectionType): {
  canDeleteRemote: boolean;
  canDeleteLocal: boolean;
} {
  switch (syncDirection) {
    case "bidirectional":
      return { canDeleteRemote: true, canDeleteLocal: true };
    case "incremental_push_only":
      return { canDeleteRemote: false, canDeleteLocal: false };
    case "incremental_push_and_delete_only":
      return { canDeleteRemote: true, canDeleteLocal: false };
    case "incremental_pull_only":
      return { canDeleteRemote: false, canDeleteLocal: false };
    case "incremental_pull_and_delete_only":
      return { canDeleteRemote: false, canDeleteLocal: true };
  }
}

function canPushToRemote(syncDirection: SyncDirectionType): boolean {
  return (
    syncDirection === "bidirectional" ||
    syncDirection === "incremental_push_only" ||
    syncDirection === "incremental_push_and_delete_only"
  );
}

function canPullToLocal(syncDirection: SyncDirectionType): boolean {
  return (
    syncDirection === "bidirectional" ||
    syncDirection === "incremental_pull_only" ||
    syncDirection === "incremental_pull_and_delete_only"
  );
}

function resolveFileDecision(
  m: MixedEntity,
  syncDirection: SyncDirectionType,
  conflictAction: ConflictActionType,
  skipSizeLargerThan: number
): void {
  if (isFolderKey(m.key)) {
    resolveFolderDecision(m, syncDirection);
    return;
  }

  const local = m.local;
  const remote = m.remote;
  const prev = m.prevSync;

  const hasLocal = local !== undefined;
  const hasRemote = remote !== undefined;
  const hasPrev = prev !== undefined;

  if (hasLocal && hasRemote && hasPrev) {
    const localEq = entityEquals(local, prev);
    const remoteEq = entityEquals(remote, prev);
    if (localEq && remoteEq) {
      m.decision = "equal";
    } else if (!localEq && remoteEq) {
      m.decision = "local_is_modified_then_push";
    } else if (localEq && !remoteEq) {
      m.decision = "remote_is_modified_then_pull";
    } else {
      applyConflictDecision(m, "conflict_modified", conflictAction);
    }
    return;
  }

  if (hasLocal && hasPrev && !hasRemote) {
    const localEq = entityEquals(local, prev);
    const { canDeleteLocal } = decideDeletionDirection(syncDirection);
    if (localEq) {
      if (canDeleteLocal) {
        m.decision = "remote_is_deleted_thus_also_delete_local";
      } else {
        m.decision = "equal";
      }
    } else {
      if (canDeleteLocal) {
        m.decision = "remote_is_deleted_thus_also_delete_local";
      } else {
        m.decision = "conflict_modified_then_keep_local";
      }
    }
    return;
  }

  if (hasRemote && hasPrev && !hasLocal) {
    const remoteEq = entityEquals(remote, prev);
    const { canDeleteRemote } = decideDeletionDirection(syncDirection);
    if (remoteEq) {
      if (canDeleteRemote) {
        m.decision = "local_is_deleted_thus_also_delete_remote";
      } else {
        m.decision = "equal";
      }
    } else {
      if (canDeleteRemote) {
        m.decision = "local_is_deleted_thus_also_delete_remote";
      } else {
        m.decision = "conflict_modified_then_keep_remote";
      }
    }
    return;
  }

  if (hasLocal && !hasRemote && !hasPrev) {
    if (canPushToRemote(syncDirection)) {
      const localSize = entitySizeBytes(local);
      if (skipSizeLargerThan > 0 && localSize > skipSizeLargerThan) {
        m.decision = "local_is_created_too_large_then_do_nothing";
        return;
      }
      m.decision = "local_is_created_then_push";
    } else {
      m.decision = "equal";
    }
    return;
  }

  if (!hasLocal && hasRemote && !hasPrev) {
    if (canPullToLocal(syncDirection)) {
      const remoteSize = entitySizeBytes(remote);
      if (skipSizeLargerThan > 0 && remoteSize > skipSizeLargerThan) {
        m.decision = "remote_is_created_too_large_then_do_nothing";
        return;
      }
      m.decision = "remote_is_created_then_pull";
    } else {
      m.decision = "equal";
    }
    return;
  }

  if (hasLocal && hasRemote && !hasPrev) {
    if (entityEquals(local, remote)) {
      m.decision = "equal";
    } else {
      applyConflictDecision(m, "conflict_created", conflictAction);
    }
    return;
  }

  if (!hasLocal && !hasRemote && hasPrev) {
    m.decision = "only_history";
    return;
  }

  m.decision = "equal";
}

function applyConflictDecision(
  m: MixedEntity,
  base: "conflict_created" | "conflict_modified",
  conflictAction: ConflictActionType
): void {
  switch (conflictAction) {
    case "keep_newer": {
      const localMtime = entityMtimeCli(m.local);
      const remoteMtime = entityMtimeCli(m.remote);
      if (localMtime >= remoteMtime) {
        m.decision = `${base}_then_keep_local` as DecisionTypeForMixedEntity;
      } else {
        m.decision = `${base}_then_keep_remote` as DecisionTypeForMixedEntity;
      }
      break;
    }
    case "keep_larger": {
      const localSize = entitySizeBytes(m.local);
      const remoteSize = entitySizeBytes(m.remote);
      if (localSize >= remoteSize) {
        m.decision = `${base}_then_keep_local` as DecisionTypeForMixedEntity;
      } else {
        m.decision = `${base}_then_keep_remote` as DecisionTypeForMixedEntity;
      }
      break;
    }
  }
}

function resolveFolderDecision(
  m: MixedEntity,
  syncDirection: SyncDirectionType
): void {
  const hasLocal = m.local !== undefined;
  const hasRemote = m.remote !== undefined;
  const hasPrev = m.prevSync !== undefined;

  if (hasLocal && hasRemote) {
    m.decision = "folder_existed_both_then_do_nothing";
    return;
  }

  if (hasLocal && !hasRemote) {
    if (canPushToRemote(syncDirection) && !hasPrev) {
      m.decision = "folder_existed_local_then_also_create_remote";
    } else if (
      hasPrev &&
      decideDeletionDirection(syncDirection).canDeleteRemote
    ) {
      m.decision = "folder_to_be_deleted_on_local";
    } else {
      m.decision = "folder_existed_both_then_do_nothing";
    }
    return;
  }

  if (!hasLocal && hasRemote) {
    if (canPullToLocal(syncDirection) && !hasPrev) {
      m.decision = "folder_existed_remote_then_also_create_local";
    } else if (
      hasPrev &&
      decideDeletionDirection(syncDirection).canDeleteLocal
    ) {
      m.decision = "folder_to_be_deleted_on_remote";
    } else {
      m.decision = "folder_existed_both_then_do_nothing";
    }
    return;
  }

  if (!hasLocal && !hasRemote && hasPrev) {
    m.decision = "folder_to_be_deleted_on_both";
    return;
  }

  m.decision = "folder_to_skip";
}

function needsActualTransfer(decision: DecisionTypeForMixedEntity): boolean {
  switch (decision) {
    case "local_is_modified_then_push":
    case "local_is_created_then_push":
    case "remote_is_modified_then_pull":
    case "remote_is_created_then_pull":
    case "conflict_created_then_keep_local":
    case "conflict_created_then_keep_remote":
    case "conflict_modified_then_keep_local":
    case "conflict_modified_then_keep_remote":
      return true;
    default:
      return false;
  }
}

function needsDeleteLocal(decision: DecisionTypeForMixedEntity): boolean {
  return (
    decision === "remote_is_deleted_thus_also_delete_local" ||
    decision === "folder_to_be_deleted_on_local" ||
    decision === "folder_to_be_deleted_on_both"
  );
}

function needsDeleteRemote(decision: DecisionTypeForMixedEntity): boolean {
  return (
    decision === "local_is_deleted_thus_also_delete_remote" ||
    decision === "folder_to_be_deleted_on_remote" ||
    decision === "folder_to_be_deleted_on_both"
  );
}

function needsFolderCreateLocal(decision: DecisionTypeForMixedEntity): boolean {
  return (
    decision === "folder_existed_remote_then_also_create_local" ||
    decision === "folder_to_be_deleted_on_remote" ||
    decision === "folder_to_be_deleted_on_both"
  );
}

function needsFolderCreateRemote(
  decision: DecisionTypeForMixedEntity
): boolean {
  return (
    decision === "folder_existed_local_then_also_create_remote" ||
    decision === "folder_to_be_deleted_on_local" ||
    decision === "folder_to_be_deleted_on_both"
  );
}

export async function ensembleMixedEnties(
  localEntities: Entity[],
  prevSyncEntities: Entity[],
  remoteEntities: Entity[],
  syncConfigDir: boolean,
  syncBookmarks: boolean,
  configDir: string,
  syncUnderscoreItems: boolean,
  ignorePaths: string[],
  onlyAllowPaths: string[],
  fsEncrypt: FakeFsEncrypt,
  serviceType: SUPPORTED_SERVICES_TYPE,
  profiler?: Profiler
): Promise<SyncPlanType> {
  const mixed = buildMixedEntityMap(
    localEntities,
    prevSyncEntities,
    remoteEntities
  );

  for (const key of Object.getOwnPropertyNames(mixed)) {
    if (
      shouldSkipPath(
        key,
        syncConfigDir,
        syncBookmarks,
        configDir,
        syncUnderscoreItems,
        ignorePaths,
        onlyAllowPaths
      )
    ) {
      delete mixed[key];
    }
  }

  return mixed;
}

export function getSyncPlanInplace(
  mixedMappings: SyncPlanType,
  skipSizeLargerThan: number,
  conflictAction: ConflictActionType,
  syncDirection: SyncDirectionType,
  profiler?: Profiler,
  settings?: RemotelySavePluginSettings,
  triggerSource?: SyncTriggerSourceType,
  configDir?: string
): SyncPlanType {
  for (const key of Object.getOwnPropertyNames(mixedMappings)) {
    const m = mixedMappings[key];
    resolveFileDecision(m, syncDirection, conflictAction, skipSizeLargerThan);
    if (
      m.decision !== "equal" &&
      m.decision !== "folder_existed_both_then_do_nothing" &&
      m.decision !== "folder_to_skip"
    ) {
      m.change = true;
    }
  }
  return mixedMappings;
}

async function doActualSync(
  mixedMappings: SyncPlanType,
  fsLocal: FakeFs,
  fsEncrypt: FakeFsEncrypt,
  vaultRandomID: string,
  profileID: string,
  concurrency: number,
  protectModifyPercentage: number,
  getProtectModifyPercentageErrorStrFunc: any,
  db: InternalDBs,
  profiler?: Profiler,
  conflictAction?: ConflictActionType,
  triggerSource?: SyncTriggerSourceType,
  callbackSyncProcess?: any
): Promise<void> {
  const allKeys = Object.getOwnPropertyNames(mixedMappings);
  const changeKeys = allKeys.filter((k) => mixedMappings[k].change === true);
  const equalKeys = allKeys.filter((k) => mixedMappings[k].change !== true);

  const totalFiles = allKeys.length;
  const changeCount = changeKeys.length;

  if (totalFiles > 0 && changeCount > 0) {
    // Detect first-time sync to empty remote:
    // If the remote has no objects (no remote-side decisions) and all changes
    // are local creations, this is a legitimate first sync, not data loss.
    const hasRemoteContent = changeKeys.some((k) => {
      const d = mixedMappings[k].decision;
      return (
        d === "remote_is_created_then_pull" ||
        d === "remote_is_modified_then_pull" ||
        d === "remote_is_deleted_thus_also_delete_local" ||
        d === "conflict_created_then_keep_remote" ||
        d === "conflict_modified_then_keep_remote"
      );
    });
    const allLocalCreations = changeKeys.every((k) => {
      const d = mixedMappings[k].decision;
      return (
        d === "local_is_created_then_push" ||
        d === "local_is_modified_then_push"
      );
    });
    const isFirstSync =
      !hasRemoteContent && allLocalCreations && totalFiles > 50;

    if (isFirstSync) {
      console.info(
        `detected first-time sync to empty/sparse remote: ${changeCount} local changes, ` +
          `${totalFiles} total files, bypassing protectModifyPercentage check`
      );
    } else {
      const percent = (100 * changeCount) / totalFiles;
      if (percent > protectModifyPercentage) {
        throw new Error(
          getProtectModifyPercentageErrorStrFunc(
            protectModifyPercentage,
            changeCount,
            totalFiles
          )
        );
      }
    }
  }

  const folderKeysToCreateOnRemote: string[] = [];
  const folderKeysToCreateOnLocal: string[] = [];
  const deletionKeysLocal: string[] = [];
  const deletionKeysRemote: string[] = [];
  const transferOps: { key: string; decision: DecisionTypeForMixedEntity }[] =
    [];
  const markSyncedKeys: string[] = [];

  for (const key of changeKeys) {
    const m = mixedMappings[key];
    const d = m.decision!;

    if (d === "only_history") {
      markSyncedKeys.push(key);
      continue;
    }

    if (isFolderKey(key)) {
      if (needsFolderCreateLocal(d)) {
        folderKeysToCreateOnLocal.push(key);
      }
      if (needsFolderCreateRemote(d)) {
        folderKeysToCreateOnRemote.push(key);
      }
      if (needsDeleteLocal(d)) {
        deletionKeysLocal.push(key);
      }
      if (needsDeleteRemote(d)) {
        deletionKeysRemote.push(key);
      }
      continue;
    }

    if (d === "local_is_deleted_thus_also_delete_remote") {
      deletionKeysRemote.push(key);
      continue;
    }
    if (d === "remote_is_deleted_thus_also_delete_local") {
      deletionKeysLocal.push(key);
      continue;
    }

    if (
      d === "local_is_created_too_large_then_do_nothing" ||
      d === "remote_is_created_too_large_then_do_nothing" ||
      d === "conflict_created_then_do_nothing"
    ) {
      markSyncedKeys.push(key);
      continue;
    }

    if (needsActualTransfer(d)) {
      transferOps.push({ key, decision: d });
    }
  }

  const prevSyncSaver = async (key: string) => {
    const m = mixedMappings[key];
    if (m === undefined) return;
    if (m.local !== undefined) {
      await upsertPrevSyncRecordByVaultAndProfile(
        db,
        vaultRandomID,
        profileID,
        m.local
      );
    } else if (m.remote !== undefined) {
      await upsertPrevSyncRecordByVaultAndProfile(
        db,
        vaultRandomID,
        profileID,
        m.remote
      );
    }
  };

  for (const key of equalKeys) {
    const m = mixedMappings[key];
    if (m.local !== undefined) {
      await upsertPrevSyncRecordByVaultAndProfile(
        db,
        vaultRandomID,
        profileID,
        m.local
      );
    }
  }

  for (const key of markSyncedKeys) {
    await prevSyncSaver(key);
  }

  folderKeysToCreateOnRemote.sort();
  folderKeysToCreateOnLocal.sort();
  deletionKeysRemote.sort((a, b) => b.length - a.length);
  deletionKeysLocal.sort((a, b) => b.length - a.length);

  for (const key of folderKeysToCreateOnRemote) {
    try {
      await fsEncrypt.mkdir(key);
    } catch (e: any) {
      console.warn(`mkdir remote ${key}: ${e.message}`);
    }
    const m = mixedMappings[key];
    if (m?.local !== undefined) {
      await upsertPrevSyncRecordByVaultAndProfile(
        db,
        vaultRandomID,
        profileID,
        m.local
      );
    }
  }

  for (const key of folderKeysToCreateOnLocal) {
    try {
      await fsLocal.mkdir(key);
    } catch (e: any) {
      console.warn(`mkdir local ${key}: ${e.message}`);
    }
    const m = mixedMappings[key];
    if (m?.remote !== undefined) {
      await upsertPrevSyncRecordByVaultAndProfile(
        db,
        vaultRandomID,
        profileID,
        m.remote
      );
    }
  }

  // Use batch delete for remote keys when there are multiple deletions
  if (deletionKeysRemote.length > 0) {
    try {
      await fsEncrypt.rmBatch(deletionKeysRemote);
      // Clear prevSync records for all deleted keys
      for (const key of deletionKeysRemote) {
        await clearPrevSyncRecordByVaultAndProfile(
          db,
          vaultRandomID,
          profileID,
          key
        );
      }
    } catch (e: any) {
      // Fall back to individual deletes if batch fails
      console.warn(
        `rmBatch failed, falling back to individual remote deletes: ${e.message}`
      );
      const remoteDeleteQueue = new PQueue({ concurrency });
      const deleteRemoteErrors: Error[] = [];
      for (const key of deletionKeysRemote) {
        remoteDeleteQueue.add(async () => {
          try {
            await fsEncrypt.rm(key);
            await clearPrevSyncRecordByVaultAndProfile(
              db,
              vaultRandomID,
              profileID,
              key
            );
          } catch (e: any) {
            deleteRemoteErrors.push(e);
          }
        });
      }
      await remoteDeleteQueue.onIdle();
      if (deleteRemoteErrors.length > 0) {
        throw new AggregateError(deleteRemoteErrors);
      }
    }
  }

  const localDeleteQueue = new PQueue({ concurrency });
  const deleteLocalErrors: Error[] = [];
  for (const key of deletionKeysLocal) {
    localDeleteQueue.add(async () => {
      try {
        await fsLocal.rm(key);
        await clearPrevSyncRecordByVaultAndProfile(
          db,
          vaultRandomID,
          profileID,
          key
        );
      } catch (e: any) {
        deleteLocalErrors.push(e);
      }
    });
  }
  await localDeleteQueue.onIdle();
  if (deleteLocalErrors.length > 0) {
    throw new AggregateError(deleteLocalErrors);
  }

  let transferCounter = 0;
  const totalTransferCount = transferOps.length;
  const transferQueue = new PQueue({ concurrency });
  const transferErrors: Error[] = [];

  for (const op of transferOps) {
    transferQueue.add(async () => {
      const { key, decision } = op;
      try {
        const isPush =
          decision === "local_is_modified_then_push" ||
          decision === "local_is_created_then_push" ||
          decision === "conflict_created_then_keep_local" ||
          decision === "conflict_modified_then_keep_local";

        const isPull =
          decision === "remote_is_modified_then_pull" ||
          decision === "remote_is_created_then_pull" ||
          decision === "conflict_created_then_keep_remote" ||
          decision === "conflict_modified_then_keep_remote";

        if (isPush) {
          const result = await copyFileOrFolder(key, fsLocal, fsEncrypt);
          if (result.entity !== undefined) {
            await upsertPrevSyncRecordByVaultAndProfile(
              db,
              vaultRandomID,
              profileID,
              result.entity
            );
          }
        } else if (isPull) {
          const result = await copyFileOrFolder(key, fsEncrypt, fsLocal);
          if (result.entity !== undefined) {
            await upsertPrevSyncRecordByVaultAndProfile(
              db,
              vaultRandomID,
              profileID,
              result.entity
            );
          }
        }

        transferCounter++;
        if (callbackSyncProcess !== undefined) {
          await callbackSyncProcess(
            triggerSource,
            transferCounter,
            totalTransferCount,
            key,
            decision
          );
        }
      } catch (e: any) {
        transferErrors.push(e);
      }
    });
  }

  await transferQueue.onIdle();
  if (transferErrors.length > 0) {
    throw new AggregateError(transferErrors);
  }
}

async function processPendingOps(
  pendingOps: PendingOp[],
  fsLocal: FakeFs,
  fsEncrypt: FakeFsEncrypt,
  db: InternalDBs,
  vaultRandomID: string,
  profileID: string
) {
  for (const op of pendingOps) {
    try {
      if (op.type === "create" || op.type === "modify") {
        let content: ArrayBuffer;
        try {
          content = await fsLocal.readFile(op.key);
        } catch {
          console.debug(
            `skip pending ${op.type} for ${op.key}: local file not found`
          );
          continue;
        }
        let mtime = Date.now();
        let ctime = Date.now();
        try {
          const stat = await fsLocal.stat(op.key);
          mtime = stat.mtimeCli ?? Date.now();
          ctime = stat.ctimeCli ?? Date.now();
        } catch {}
        const entity = await fsEncrypt.writeFileSingle(
          op.key,
          content,
          mtime,
          ctime
        );
        await upsertPrevSyncRecordByVaultAndProfile(
          db,
          vaultRandomID,
          profileID,
          entity
        );
      } else if (op.type === "rename" && op.newKey !== undefined) {
        let content: ArrayBuffer;
        try {
          content = await fsLocal.readFile(op.newKey);
        } catch {
          console.debug(
            `skip pending rename for ${op.key} -> ${op.newKey}: local file not found`
          );
          continue;
        }
        let mtime = Date.now();
        let ctime = Date.now();
        try {
          const stat = await fsLocal.stat(op.newKey);
          mtime = stat.mtimeCli ?? Date.now();
          ctime = stat.ctimeCli ?? Date.now();
        } catch {}
        const entity = await fsEncrypt.writeFileSingle(
          op.newKey,
          content,
          mtime,
          ctime
        );
        try {
          await fsEncrypt.rmSingle(op.key);
        } catch {
          console.debug(
            `cleanup old key after rename: ${op.key} not found on remote`
          );
        }
        await upsertPrevSyncRecordByVaultAndProfile(
          db,
          vaultRandomID,
          profileID,
          entity
        );
        await clearPrevSyncRecordByVaultAndProfile(
          db,
          vaultRandomID,
          profileID,
          op.key
        );
      } else if (op.type === "delete") {
        // Local file was deleted, propagate deletion to remote
        try {
          await fsEncrypt.rmSingle(op.key);
        } catch (e) {
          console.debug(`delete remote for ${op.key}: ${e}`);
        }
        await clearPrevSyncRecordByVaultAndProfile(
          db,
          vaultRandomID,
          profileID,
          op.key
        );
      }
    } catch (e) {
      console.warn(`failed to process pending op for ${op.key}: ${e}`);
    }
  }
}

// ── Incremental sync constants ──

/** Maximum journal entries before forcing a full sync. */
const MAX_JOURNAL_ENTRIES = 5000;

/** Key prefix in simpleKVForMiscTbl for remote snapshot storage. */
const REMOTE_SNAPSHOT_KEY = "remote-snapshot";
const REMOTE_MANIFEST_STAT_KEY = "remote-manifest-stat";
const LOCAL_CHANGE_STAT_KEY = "local-change-stat";

/**
 * Store the latest remote snapshot after a successful full walk.
 */
async function storeRemoteSnapshot(
  db: InternalDBs,
  vaultRandomID: string,
  snapshot: RemoteSnapshot
) {
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}\t${REMOTE_SNAPSHOT_KEY}`,
    snapshot
  );
}

/**
 * Load the previous remote snapshot.
 */
async function loadRemoteSnapshot(
  db: InternalDBs,
  vaultRandomID: string
): Promise<RemoteSnapshot | null> {
  return (await db.simpleKVForMiscTbl.getItem(
    `${vaultRandomID}\t${REMOTE_SNAPSHOT_KEY}`
  )) as RemoteSnapshot | null;
}

async function storeRemoteManifestStat(
  db: InternalDBs,
  vaultRandomID: string,
  stat: RemoteManifestStat
) {
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}\t${REMOTE_MANIFEST_STAT_KEY}`,
    stat
  );
}

async function loadRemoteManifestStat(
  db: InternalDBs,
  vaultRandomID: string
): Promise<RemoteManifestStat | null> {
  return (await db.simpleKVForMiscTbl.getItem(
    `${vaultRandomID}\t${REMOTE_MANIFEST_STAT_KEY}`
  )) as RemoteManifestStat | null;
}

async function storeLocalChangeStat(
  db: InternalDBs,
  vaultRandomID: string,
  stat: LocalChangeStat
) {
  await db.simpleKVForMiscTbl.setItem(
    `${vaultRandomID}\t${LOCAL_CHANGE_STAT_KEY}`,
    stat
  );
}

async function loadLocalChangeStat(
  db: InternalDBs,
  vaultRandomID: string
): Promise<LocalChangeStat | null> {
  return (await db.simpleKVForMiscTbl.getItem(
    `${vaultRandomID}\t${LOCAL_CHANGE_STAT_KEY}`
  )) as LocalChangeStat | null;
}

export function remoteManifestStatEquals(
  prev: RemoteManifestStat | null,
  curr: RemoteManifestStat | null
): boolean {
  if (prev === null || curr === null) {
    return false;
  }
  return (
    prev.etag === curr.etag &&
    prev.lastModified === curr.lastModified &&
    prev.size === curr.size
  );
}

export function localChangeStatEquals(
  prev: LocalChangeStat | null,
  curr: LocalChangeStat | null
): boolean {
  if (prev === null || curr === null) {
    return false;
  }
  return (
    prev.fileCount === curr.fileCount &&
    prev.newestMtime === curr.newestMtime &&
    prev.pathHash === curr.pathHash
  );
}

/**
 * Compare two RemoteSnapshot objects to detect if the remote has changed.
 * Returns true if the remote likely changed and a full sync is needed.
 */
function remoteSnapshotChanged(
  prev: RemoteSnapshot,
  curr: RemoteSnapshot
): boolean {
  if (prev.objectCount !== curr.objectCount) return true;
  if (prev.newestMtime !== curr.newestMtime) return true;
  if (prev.sampleKeys.length !== curr.sampleKeys.length) return true;
  for (let i = 0; i < prev.sampleKeys.length; i++) {
    if (prev.sampleKeys[i] !== curr.sampleKeys[i]) return true;
  }
  return false;
}

export async function syncer(
  fsLocal: FakeFs,
  fsRemote: FakeFs,
  fsEncrypt: FakeFsEncrypt,
  profiler: Profiler | undefined,
  db: InternalDBs,
  triggerSource: SyncTriggerSourceType,
  profileID: string,
  vaultRandomID: string,
  configDir: string,
  settings: RemotelySavePluginSettings,
  pluginVersion: string,
  configSaver: () => Promise<any>,
  getProtectModifyPercentageErrorStrFunc: any,
  markIsSyncingFunc: (isSyncing: boolean) => void,
  notifyFunc?: (s: SyncTriggerSourceType, step: number) => Promise<any>,
  errNotifyFunc?: (s: SyncTriggerSourceType, error: Error) => Promise<any>,
  ribboonFunc?: (s: SyncTriggerSourceType, step: number) => Promise<any>,
  statusBarFunc?: (
    s: SyncTriggerSourceType,
    step: number,
    everythingOk: boolean
  ) => any,
  callbackSyncProcess?: any
) {
  console.info("starting sync (open-source engine).");
  markIsSyncingFunc(true);

  let everythingOk = true;
  let step = 0;

  try {
    await notifyFunc?.(triggerSource, step);

    step = 1;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    profiler?.insert("start big sync func");

    step = 2;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    if (fsEncrypt.innerFs !== fsRemote) {
      throw new Error("your enc should has inner of the remote");
    }
    const passwordCheckResult = await fsEncrypt.isPasswordOk();
    if (!passwordCheckResult.ok) {
      throw new Error(passwordCheckResult.reason);
    }
    profiler?.insert(`finish step${step} (check password)`);

    // Check for interrupted sync checkpoint
    if (triggerSource !== "dry") {
      const existingCp = await getSyncCheckpoint(db, vaultRandomID);
      if (existingCp !== null && existingCp.status === "in_progress") {
        const ageHours = (Date.now() - existingCp.startedAt) / 3600000;
        if (ageHours < 24) {
          console.info(
            `found previous sync checkpoint from ${new Date(existingCp.startedAt).toISOString()}, ` +
              `completed ${existingCp.completedOps}/${existingCp.totalOps} ops`
          );
        } else {
          console.info(
            `found stale sync checkpoint older than 24h, clearing it`
          );
          await clearSyncCheckpoint(db, vaultRandomID);
        }
      }
    }

    const pendingOps =
      triggerSource !== "dry"
        ? await getPendingOps(db, vaultRandomID, profileID)
        : [];

    let incrementalSkipLocal = false;
    let localUnchangedFastPath = false;

    if (pendingOps.length > 0) {
      if (pendingOps.length <= MAX_JOURNAL_ENTRIES) {
        console.info(
          `incremental sync: processing ${pendingOps.length} pending operations`
        );
        await processPendingOps(
          pendingOps,
          fsLocal,
          fsEncrypt,
          db,
          vaultRandomID,
          profileID
        );
        await clearPendingOps(db, vaultRandomID, profileID);
        profiler?.insert("finish processing pending ops");

        // Incremental path: always walk remote (catches changes from other devices),
        // but skip local walk — use prevSync as proxy for local state.
        // We already pushed all tracked local changes, so local ≡ prevSync.
        incrementalSkipLocal = true;
        console.info(
          "incremental sync: will walk remote, skip local walk (using prevSync as local)"
        );
      } else {
        console.warn(
          `too many pending ops (${pendingOps.length} > ${MAX_JOURNAL_ENTRIES}), falling back to full sync`
        );
        await clearPendingOps(db, vaultRandomID, profileID);
      }
    }

    let remoteManifest: RemoteManifest | null = null;
    let currentManifestStat: RemoteManifestStat | null = null;
    let currentLocalChangeStat: LocalChangeStat | null = null;
    let manifestBasedSync = false;
    let usedManifestAsRemoteState = false;

    if (fsEncrypt.innerFs.kind === "s3" && pendingOps.length === 0) {
      const previousManifestStat = await loadRemoteManifestStat(
        db,
        vaultRandomID
      );
      const previousLocalChangeStat = await loadLocalChangeStat(
        db,
        vaultRandomID
      );
      currentManifestStat = await fsEncrypt.statManifest(vaultRandomID);
      currentLocalChangeStat = await fsLocal.statLocalChanges();
      if (remoteManifestStatEquals(previousManifestStat, currentManifestStat)) {
        try {
          remoteManifest = await fsEncrypt.readManifest(vaultRandomID);
          if (remoteManifest) {
            usedManifestAsRemoteState = true;
            localUnchangedFastPath = localChangeStatEquals(
              previousLocalChangeStat,
              currentLocalChangeStat
            );
            if (localUnchangedFastPath) {
              incrementalSkipLocal = true;
              console.info(
                `local and remote unchanged since last sync, skipping local+remote walk (${Object.keys(remoteManifest.files).length} files from manifest)`
              );
            } else {
              console.info(
                `remote manifest unchanged since last sync, using manifest state directly (${Object.keys(remoteManifest.files).length} files)`
              );
            }
          }
        } catch (e) {
          console.debug("readManifest fast path failed, falling back", e);
        }
      }
    }

    if (!usedManifestAsRemoteState) {
      try {
        if (remoteManifest === null) {
          remoteManifest = await fsEncrypt.readManifest(vaultRandomID);
        }
        if (remoteManifest) {
          const mCount = Object.keys(remoteManifest.files).length;
          console.info(
            `remote manifest found: ${mCount} files, synced at ${new Date(remoteManifest.syncedAt).toISOString()}`
          );
        } else {
          console.info(
            "no remote manifest found, using full walk + IndexedDB prevSync"
          );
        }
      } catch (e) {
        console.debug("readManifest failed, using full walk", e);
      }
    }

    step = 3;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    let remoteEntityList: Entity[];
    if (usedManifestAsRemoteState && remoteManifest !== null) {
      remoteEntityList = manifestToEntities(remoteManifest);
      manifestBasedSync = true;
      profiler?.insert(`finish step${step} (reuse remote manifest state)`);
    } else {
      remoteEntityList = remoteManifest
        ? await fsEncrypt.walkFromManifest(remoteManifest)
        : await fsEncrypt.walk();
      manifestBasedSync =
        remoteManifest !== null && fsEncrypt.manifestBasedWalk;
      profiler?.insert(`finish step${step} (list remote)`);
    }

    step = 4;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    let localEntityList: Entity[] = [];
    if (incrementalSkipLocal) {
      if (localUnchangedFastPath) {
        console.info(
          "local snapshot unchanged: skipping local walk (will use prevSync as proxy)"
        );
        profiler?.insert("skip step4 (local walk): local unchanged fast path");
      } else {
        console.info(
          "incremental sync: skipping local walk (will use prevSync as proxy)"
        );
        profiler?.insert("skip step4 (local walk): incremental mode");
      }
    } else {
      localEntityList = await fsLocal.walk();
      profiler?.insert(`finish step${step} (list local)`);
    }

    step = 5;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    let prevSyncEntityList: Entity[];

    if (manifestBasedSync && remoteManifest) {
      // Use remote manifest as prevSync — shared state across devices
      prevSyncEntityList = manifestToEntities(remoteManifest);
      console.info(
        `using remote manifest as prevSync: ${prevSyncEntityList.length} entries`
      );
    } else {
      prevSyncEntityList = await getAllPrevSyncRecordsByVaultAndProfile(
        db,
        vaultRandomID,
        profileID
      );

      // If no prevSync records for current profile, try fallback to any profile
      // This handles backend switching (e.g., WebDAV → S3) without data loss
      if (prevSyncEntityList.length === 0) {
        const fallback = await getPrevSyncRecordsByVaultAnyProfile(
          db,
          vaultRandomID
        );
        if (fallback !== null) {
          console.info(
            `no prevSync for profile '${profileID}', falling back to '${fallback.profileID}' records (${fallback.entities.length} entities)`
          );
          prevSyncEntityList = fallback.entities;
        }
      }
    }
    profiler?.insert(`finish step${step} (prev sync)`);

    // In incremental mode, use the prevSync records as a proxy for local state.
    // We already pushed all tracked local changes, so local ≡ prevSync.
    // The three-way comparison will then only pull remote→local changes.
    if (incrementalSkipLocal) {
      localEntityList = [...prevSyncEntityList];
      if (localUnchangedFastPath) {
        console.info(
          `local snapshot unchanged: using ${prevSyncEntityList.length} prevSync entities as local proxy`
        );
      } else {
        console.info(
          `incremental sync: using ${prevSyncEntityList.length} prevSync entities as local proxy`
        );
      }
    }

    step = 6;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    let mixedEntityMappings = await ensembleMixedEnties(
      localEntityList,
      prevSyncEntityList,
      remoteEntityList,
      settings.syncConfigDir ?? false,
      settings.syncBookmarks ?? false,
      configDir,
      settings.syncUnderscoreItems ?? false,
      settings.ignorePaths ?? [],
      settings.onlyAllowPaths ?? [],
      fsEncrypt,
      settings.serviceType,
      profiler
    );
    profiler?.insert(`finish step${step} (build mixed entities)`);

    mixedEntityMappings = getSyncPlanInplace(
      mixedEntityMappings,
      settings.skipSizeLargerThan ?? -1,
      settings.conflictAction ?? "keep_newer",
      settings.syncDirection ?? "bidirectional",
      profiler,
      settings,
      triggerSource,
      configDir
    );
    profiler?.insert("finish building sync plan");

    const allKeys = Object.getOwnPropertyNames(mixedEntityMappings);
    const changeKeys = allKeys.filter(
      (k) => mixedEntityMappings[k].change === true
    );
    const hasChanges = changeKeys.length > 0;

    await insertSyncPlanRecordByVault(
      db,
      mixedEntityMappings,
      vaultRandomID,
      settings.serviceType
    );
    profiler?.insert("finish writing sync plan");
    profiler?.insert(`finish step${step} (make plan)`);

    step = 7;
    if (triggerSource !== "dry") {
      await notifyFunc?.(triggerSource, step);
      await ribboonFunc?.(triggerSource, step);
      await statusBarFunc?.(triggerSource, step, everythingOk);

      await saveSyncCheckpoint(db, {
        syncId: `sync-${Date.now()}`,
        vaultRandomID,
        profileID,
        startedAt: Date.now(),
        totalOps: changeKeys.length,
        completedOps: 0,
        lastCompletedKey: "",
        status: "in_progress",
      });

      await doActualSync(
        mixedEntityMappings,
        fsLocal,
        fsEncrypt,
        vaultRandomID,
        profileID,
        settings.concurrency ?? 5,
        settings.protectModifyPercentage ?? 50,
        getProtectModifyPercentageErrorStrFunc,
        db,
        profiler,
        settings.conflictAction ?? "keep_newer",
        triggerSource,
        callbackSyncProcess
      );
      profiler?.insert(`finish step${step} (actual sync)`);

      // Clear checkpoint after successful sync
      await clearSyncCheckpoint(db, vaultRandomID);
    } else {
      await notifyFunc?.(triggerSource, step);
      await ribboonFunc?.(triggerSource, step);
      await statusBarFunc?.(triggerSource, step, everythingOk);
      profiler?.insert(
        `finish step${step} (skip actual sync because of dry run)`
      );
    }

    if (triggerSource !== "dry" && fsEncrypt.innerFs.kind === "s3") {
      try {
        if (hasChanges) {
          const syncId = `sync-${Date.now()}`;
          const freshEntities = await fsEncrypt.walk();
          const freshManifest = entitiesToManifest(
            freshEntities,
            vaultRandomID,
            syncId
          );
          await fsEncrypt.writeManifest(vaultRandomID, freshManifest);
          console.info(
            `wrote fresh remote manifest: ${freshManifest.summary.fileCount} files`
          );
          currentManifestStat = await fsEncrypt.statManifest(vaultRandomID);
        } else {
          console.info(
            "no sync changes detected, skipping remote manifest rewrite"
          );
        }

        if (currentManifestStat !== null) {
          await storeRemoteManifestStat(db, vaultRandomID, currentManifestStat);
        }
      } catch (e) {
        console.warn("failed to write or store remote manifest", e);
      }
    }

    if (triggerSource !== "dry") {
      const latestLocalChangeStat =
        currentLocalChangeStat ?? (await fsLocal.statLocalChanges());
      if (latestLocalChangeStat !== null) {
        await storeLocalChangeStat(db, vaultRandomID, latestLocalChangeStat);
      }

      if (fsEncrypt.innerFs.kind === "s3" && !hasChanges) {
        console.info(
          "no sync changes detected, skipping remote snapshot refresh"
        );
      } else {
        const snapshot = await fsEncrypt.checkRemoteChanges();
        if (snapshot) {
          await storeRemoteSnapshot(db, vaultRandomID, snapshot);
        }
      }
    }
  } catch (error: any) {
    profiler?.insert("start error branch");
    everythingOk = false;
    // Mark checkpoint as failed if exists
    try {
      const cp = await getSyncCheckpoint(db, vaultRandomID);
      if (cp !== null && cp.status === "in_progress") {
        cp.status = "failed";
        cp.errorMessage = error.message;
        await saveSyncCheckpoint(db, cp);
      }
    } catch {
      // silently ignore checkpoint errors
    }
    await errNotifyFunc?.(triggerSource, error as Error);
    profiler?.insert("finish error branch");
  }

  profiler?.insert("finish syncRun");
  await profiler?.save(db, vaultRandomID, settings.serviceType);

  step = 8;
  await notifyFunc?.(triggerSource, step);
  await ribboonFunc?.(triggerSource, step);
  await statusBarFunc?.(triggerSource, step, everythingOk);

  console.info("ending sync (open-source engine).");
  markIsSyncingFunc(false);
}

// ── Remote Manifest helpers ──

/**
 * Convert a RemoteManifest to an Entity[].
 * This represents the "prevSync" state — what we last knew was synced.
 */
function manifestToEntities(manifest: RemoteManifest): Entity[] {
  const entities: Entity[] = [];
  const seenFolders = new Set<string>();

  for (const [relPath, entry] of Object.entries(manifest.files)) {
    entities.push({
      key: relPath,
      keyRaw: relPath,
      mtimeCli: entry.mtime,
      mtimeSvr: entry.mtime,
      size: entry.size,
      sizeRaw: entry.size,
      etag: entry.etag,
      synthesizedFolder: false,
    });

    // Add synthetic folder entries for parent directories
    const parts = relPath.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const folderKey = parts.slice(0, i + 1).join("/") + "/";
      if (!seenFolders.has(folderKey)) {
        seenFolders.add(folderKey);
        entities.push({
          key: folderKey,
          keyRaw: folderKey,
          size: 0,
          sizeRaw: 0,
          mtimeSvr: entry.mtime,
          mtimeCli: entry.mtime,
          synthesizedFolder: true,
        });
      }
    }
  }

  return entities;
}

/**
 * Build a RemoteManifest from the sync plan decisions.
 * This correctly captures the post-sync remote state by using
 * the "winning" entity for each key:
 * - push/keep_local → use the local entity (now on remote)
 * - pull/keep_remote → use the remote entity (unchanged on remote)
 * - equal → use whichever entity exists
 * - delete remote → exclude from manifest
 */
function buildManifestFromSyncPlan(
  mixedMappings: SyncPlanType,
  vaultRandomID: string,
  syncId: string
): RemoteManifest {
  const files: Record<string, ManifestEntry> = {};
  let newestMtime = 0;

  for (const key of Object.getOwnPropertyNames(mixedMappings)) {
    if (key.endsWith("/")) continue; // Skip folder keys

    const m = mixedMappings[key];
    const decision = m.decision;

    // Skip keys deleted from remote
    if (
      decision === "local_is_deleted_thus_also_delete_remote" ||
      decision === "folder_to_be_deleted_on_remote" ||
      decision === "folder_to_be_deleted_on_both"
    ) {
      continue;
    }

    // Pick the "winning" entity → this is what's now on remote
    let winner: Entity | undefined;

    // push or keep_local → local was written to remote
    if (
      decision === "local_is_modified_then_push" ||
      decision === "local_is_created_then_push" ||
      decision === "conflict_created_then_keep_local" ||
      decision === "conflict_modified_then_keep_local"
    ) {
      winner = m.local;
    }
    // pull or keep_remote → remote stays as-is
    else if (
      decision === "remote_is_modified_then_pull" ||
      decision === "remote_is_created_then_pull" ||
      decision === "conflict_created_then_keep_remote" ||
      decision === "conflict_modified_then_keep_remote"
    ) {
      winner = m.remote;
    }
    // equal → pick whichever exists
    else if (decision === "equal") {
      winner = m.local ?? m.remote ?? m.prevSync;
    }
    // only_history → use prevSync
    else if (decision === "only_history") {
      winner = m.prevSync;
    }
    // created too large → skip
    else if (
      decision === "local_is_created_too_large_then_do_nothing" ||
      decision === "remote_is_created_too_large_then_do_nothing"
    ) {
      continue;
    }
    // conflict_created_then_do_nothing → skip
    else if (decision === "conflict_created_then_do_nothing") {
      continue;
    }
    // Fallback: try local → remote → prevSync
    else {
      winner = m.local ?? m.remote ?? m.prevSync;
    }

    if (!winner) continue;

    const mtime = winner.mtimeCli ?? winner.mtimeSvr ?? 0;
    if (mtime > newestMtime) newestMtime = mtime;

    files[winner.keyRaw] = {
      etag: winner.etag ?? "",
      mtime,
      size: winner.size ?? winner.sizeRaw ?? 0,
      encrypted: false,
    };
  }

  return {
    version: 1,
    vaultRandomID,
    syncedAt: Date.now(),
    syncId,
    files,
    summary: {
      fileCount: Object.keys(files).length,
      newestMtime: newestMtime > 0 ? newestMtime : null,
    },
  };
}

/**
 * Build a RemoteManifest from a full set of remote entities.
 * This is called after a successful sync to store the new state.
 */
function entitiesToManifest(
  entities: Entity[],
  vaultRandomID: string,
  syncId: string
): RemoteManifest {
  const files: Record<string, ManifestEntry> = {};
  let newestMtime = 0;

  for (const e of entities) {
    // Skip folders
    if (e.keyRaw.endsWith("/")) continue;
    if (e.synthesizedFolder) continue;
    // Skip internal plugin state files
    if (e.keyRaw.startsWith("_rs_state/")) continue;

    const mtime = e.mtimeCli ?? e.mtimeSvr ?? 0;
    if (mtime > newestMtime) newestMtime = mtime;

    files[e.keyRaw] = {
      etag: e.etag ?? "",
      mtime,
      size: e.size ?? e.sizeRaw ?? 0,
      encrypted: false,
    };
  }

  return {
    version: 1,
    vaultRandomID,
    syncedAt: Date.now(),
    syncId,
    files,
    summary: {
      fileCount: Object.keys(files).length,
      newestMtime: newestMtime > 0 ? newestMtime : null,
    },
  };
}
