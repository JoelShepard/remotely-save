// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
import AggregateError from "aggregate-error";
import PQueue from "p-queue";
import type {
  ConflictActionType,
  DecisionTypeForMixedEntity,
  Entity,
  MixedEntity,
  RemotelySavePluginSettings,
  SUPPORTED_SERVICES_TYPE,
  SyncDirectionType,
  SyncTriggerSourceType,
} from "./baseTypes";
import { copyFile, copyFileOrFolder, copyFolder } from "./copyLogic";
import type { FakeFs } from "./fsAll";
import type { FakeFsEncrypt } from "./fsEncrypt";
import {
  type InternalDBs,
  clearPrevSyncRecordByVaultAndProfile,
  getAllPrevSyncRecordsByVaultAndProfile,
  insertSyncPlanRecordByVault,
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

function entityEquals(a: Entity | undefined, b: Entity | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  const mtimeA = a.mtimeCli ?? a.mtimeSvr ?? 0;
  const mtimeB = b.mtimeCli ?? b.mtimeSvr ?? 0;
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
    const { canDeleteRemote } = decideDeletionDirection(syncDirection);
    if (localEq) {
      if (canDeleteRemote) {
        m.decision = "local_is_deleted_thus_also_delete_remote";
      } else {
        m.decision = "equal";
      }
    } else {
      if (canDeleteRemote) {
        m.decision = "local_is_deleted_thus_also_delete_remote";
      } else {
        m.decision = "conflict_modified_then_keep_local";
      }
    }
    return;
  }

  if (hasRemote && hasPrev && !hasLocal) {
    const remoteEq = entityEquals(remote, prev);
    const { canDeleteLocal } = decideDeletionDirection(syncDirection);
    if (remoteEq) {
      if (canDeleteLocal) {
        m.decision = "remote_is_deleted_thus_also_delete_local";
      } else {
        m.decision = "equal";
      }
    } else {
      if (canDeleteLocal) {
        m.decision = "remote_is_deleted_thus_also_delete_local";
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

    step = 3;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    const remoteEntityList = await fsEncrypt.walk();
    profiler?.insert(`finish step${step} (list remote)`);

    step = 4;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    const localEntityList = await fsLocal.walk();
    profiler?.insert(`finish step${step} (list local)`);

    step = 5;
    await notifyFunc?.(triggerSource, step);
    await ribboonFunc?.(triggerSource, step);
    await statusBarFunc?.(triggerSource, step, everythingOk);
    const prevSyncEntityList = await getAllPrevSyncRecordsByVaultAndProfile(
      db,
      vaultRandomID,
      profileID
    );
    profiler?.insert(`finish step${step} (prev sync)`);

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
    } else {
      await notifyFunc?.(triggerSource, step);
      await ribboonFunc?.(triggerSource, step);
      await statusBarFunc?.(triggerSource, step, everythingOk);
      profiler?.insert(
        `finish step${step} (skip actual sync because of dry run)`
      );
    }
  } catch (error: any) {
    profiler?.insert("start error branch");
    everythingOk = false;
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
