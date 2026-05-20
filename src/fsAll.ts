import isEqual from "lodash/isEqual";
import { nanoid } from "nanoid";
import type { Entity, RemoteManifest } from "./baseTypes";

/**
 * Compact snapshot of the remote state for lightweight change detection.
 * Stored after each full sync and compared during incremental sync checks.
 */
export interface RemoteSnapshot {
  /** Total number of objects (files + folder objects) on the remote */
  objectCount: number;
  /** The maximum mtime (client or server) seen across all objects */
  newestMtime: number | null;
  /** Up to 10 keys with the highest mtimes (to detect modifications) */
  sampleKeys: string[];
  /** Unix timestamp when this snapshot was taken */
  capturedAt: number;
}

export interface RemoteManifestStat {
  etag: string;
  lastModified: number | null;
  size: number | null;
}

export interface LocalChangeStat {
  fileCount: number;
  newestMtime: number | null;
  pathHash: string;
}

export abstract class FakeFs {
  /** Whether the last walkFromManifest() call used manifest data (vs fallback to full walk). */
  private _manifestBasedWalk = false;

  /** @internal */
  get manifestBasedWalk(): boolean {
    return this._manifestBasedWalk;
  }

  /** @internal */
  set manifestBasedWalk(v: boolean) {
    this._manifestBasedWalk = v;
  }
  abstract kind: string;
  abstract walk(): Promise<Entity[]>;
  abstract walkPartial(): Promise<Entity[]>;
  abstract stat(key: string): Promise<Entity>;
  abstract mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity>;
  abstract writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity>;
  abstract readFile(key: string): Promise<ArrayBuffer>;
  abstract rename(key1: string, key2: string): Promise<void>;
  abstract rm(key: string): Promise<void>;

  /**
   * Batch delete multiple keys at once.
   * Default implementation falls back to sequential individual rm() calls.
   * Storage-specific adapters should override for efficiency (e.g., S3 DeleteObjects).
   */
  async rmBatch(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.rm(key);
    }
  }

  abstract checkConnect(callbackFunc?: any): Promise<boolean>;
  async checkConnectCommonOps(callbackFunc?: any) {
    try {
      console.info(`check connect: create folder`);
      const folderName = `rs-test-folder-${nanoid()}/`;
      await this.mkdir(folderName);
      // await delay(3000);

      console.info(`check connect: upload file`);
      const filename = `${folderName}rs-test-file-${nanoid()}`;
      const ctime = Date.now();
      const mtime1 = Date.now();
      const content1 = new ArrayBuffer(100);
      await this.writeFile(filename, content1, mtime1, ctime);
      // await delay(3000);

      console.info(`check connect: overwrite file`);
      const mtime2 = Date.now();
      const content2 = new ArrayBuffer(200);
      await this.writeFile(filename, content2, mtime2, ctime);
      // await delay(3000);

      console.info(`check connect: download file`);
      const content3 = await this.readFile(filename);
      if (!isEqual(content2, content3)) {
        throw Error(`downloaded file is not equal with uploaded file!`);
      }
      // await delay(3000);

      console.info(`check connect: delete file`);
      await this.rm(filename);
      // await delay(3000);

      console.info(`check connect: delete folder`);
      await this.rm(folderName);
      // await delay(3000);

      return true;
    } catch (err) {
      console.error(err);
      callbackFunc?.(err);
      return false;
    }
  }
  abstract getUserDisplayName(): Promise<string>;
  abstract revokeAuth(): Promise<any>;
  abstract allowEmptyFile(): boolean;

  /**
   * Lightweight remote change detection.
   * Makes a minimal number of API calls (~1-3) to build a fresh snapshot
   * or compare against a previous snapshot.
   *
   * @returns A fresh RemoteSnapshot, or null if the check is unavailable.
   */
  abstract checkRemoteChanges(): Promise<RemoteSnapshot | null>;

  /**
   * Read the remote sync manifest (if available).
   * Default: returns null (not supported).
   * Override in storage adapters that support manifest-based sync (e.g., S3).
   */
  async readManifest(vaultRandomID: string): Promise<RemoteManifest | null> {
    return null;
  }

  /**
   * Write the remote sync manifest.
   * Default: no-op.
   * Override in storage adapters that support manifest-based sync.
   */
  async writeManifest(
    vaultRandomID: string,
    manifest: RemoteManifest
  ): Promise<void> {
    // no-op by default
  }

  async statManifest(
    vaultRandomID: string
  ): Promise<RemoteManifestStat | null> {
    return null;
  }

  async statLocalChanges(): Promise<LocalChangeStat | null> {
    return null;
  }

  /**
   * Walk the remote using a cached manifest with bounded verification.
   * Default: falls back to full walk().
   * Override in storage adapters that support manifest-based sync.
   *
   * @param manifest The previously read remote manifest
   * @returns Entities representing the current remote state
   */
  async walkFromManifest(manifest: RemoteManifest): Promise<Entity[]> {
    this._manifestBasedWalk = false;
    return this.walk();
  }
}
