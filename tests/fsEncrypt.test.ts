import { strict as assert } from "assert";
import type { Entity } from "../src/baseTypes";
import { FakeFs } from "../src/fsAll";
import { FakeFsEncrypt } from "../src/fsEncrypt";

if (typeof globalThis.self === "undefined") {
  (globalThis as any).self = globalThis;
}

class InMemoryFs extends FakeFs {
  kind: "mock-memory";
  store: Map<string, { content: ArrayBuffer; mtime: number; ctime: number }>;

  constructor() {
    super();
    this.kind = "mock-memory";
    this.store = new Map();
  }

  async walk(): Promise<Entity[]> {
    const entities: Entity[] = [];
    for (const [key, val] of this.store) {
      const isFolder = key.endsWith("/");
      entities.push({
        key,
        keyRaw: key,
        size: isFolder ? 0 : val.content.byteLength,
        sizeRaw: isFolder ? 0 : val.content.byteLength,
        mtimeCli: val.mtime,
        mtimeSvr: val.mtime,
      });
    }
    return entities;
  }

  async walkPartial(): Promise<Entity[]> {
    return this.walk();
  }

  async stat(key: string): Promise<Entity> {
    const val = this.store.get(key);
    if (!val) throw new Error(`not found: ${key}`);
    const isFolder = key.endsWith("/");
    return {
      key,
      keyRaw: key,
      size: isFolder ? 0 : val.content.byteLength,
      sizeRaw: isFolder ? 0 : val.content.byteLength,
      mtimeCli: val.mtime,
      mtimeSvr: val.mtime,
    };
  }

  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> {
    this.store.set(key, {
      content: new ArrayBuffer(0),
      mtime: mtime ?? 0,
      ctime: ctime ?? 0,
    });
    return this.stat(key);
  }

  async writeFile(
    key: string,
    content: ArrayBuffer,
    mtime: number,
    ctime: number
  ): Promise<Entity> {
    this.store.set(key, { content, mtime, ctime });
    return this.stat(key);
  }

  async readFile(key: string): Promise<ArrayBuffer> {
    const val = this.store.get(key);
    if (!val) throw new Error(`not found: ${key}`);
    return val.content;
  }

  async rename(key1: string, key2: string): Promise<void> {
    const val = this.store.get(key1);
    if (!val) throw new Error(`not found: ${key1}`);
    this.store.set(key2, val);
    this.store.delete(key1);
  }

  async rm(key: string): Promise<void> {
    this.store.delete(key);
  }

  async checkConnect(): Promise<boolean> {
    return true;
  }

  async getUserDisplayName(): Promise<string> {
    return "mock-user";
  }

  async revokeAuth(): Promise<void> {}

  allowEmptyFile(): boolean {
    return true;
  }
}

describe("FakeFsEncrypt single operations", () => {
  beforeEach(() => {
    global.window = {
      crypto: require("crypto").webcrypto,
    } as any;
  });

  describe("without password", () => {
    it("should writeFileSingle and store unencrypted", async () => {
      const inner = new InMemoryFs();
      const enc = new FakeFsEncrypt(inner, "", "rclone-base64");

      const content = new TextEncoder().encode("hello world").buffer;
      const mtime = 1000;
      const ctime = 500;
      const entity = await enc.writeFileSingle(
        "test.md",
        content,
        mtime,
        ctime
      );

      assert.equal(entity.key, "test.md");
      assert.equal(entity.keyRaw, "test.md");
      assert.equal(entity.mtimeCli, mtime);
      assert.equal(entity.sizeRaw, 11);

      const stored = await inner.readFile("test.md");
      assert.equal(new TextDecoder().decode(stored), "hello world");

      const readBack = await enc.readFile("test.md");
      assert.equal(new TextDecoder().decode(readBack), "hello world");
    });

    it("should renameSingle on inner fs", async () => {
      const inner = new InMemoryFs();
      const enc = new FakeFsEncrypt(inner, "", "rclone-base64");

      const content = new TextEncoder().encode("rename me").buffer;
      await enc.writeFileSingle("old.md", content, 100, 50);
      await enc.renameSingle("old.md", "new.md");

      await assert.rejects(inner.readFile("old.md"));
      const stored = await inner.readFile("new.md");
      assert.equal(new TextDecoder().decode(stored), "rename me");

      const readBack = await enc.readFile("new.md");
      assert.equal(new TextDecoder().decode(readBack), "rename me");
    });

    it("should cacheKey and make readFile work", async () => {
      const inner = new InMemoryFs();
      const enc = new FakeFsEncrypt(inner, "", "rclone-base64");

      await inner.writeFile(
        "cached.md",
        new TextEncoder().encode("cached content").buffer,
        100,
        50
      );

      await enc.cacheKey("cached.md");
      const readBack = await enc.readFile("cached.md");
      assert.equal(new TextDecoder().decode(readBack), "cached content");
    });
  });

  describe("with openssl password", () => {
    const password = "test-password-123";

    it("should writeFileSingle and round-trip", async () => {
      const inner = new InMemoryFs();
      const enc = new FakeFsEncrypt(inner, password, "openssl-base64");

      const content = new TextEncoder().encode("secret data").buffer;
      const mtime = 2000;
      const ctime = 1000;
      const entity = await enc.writeFileSingle(
        "secret.md",
        content,
        mtime,
        ctime
      );

      assert.equal(entity.key, "secret.md");
      assert.equal(entity.mtimeCli, mtime);

      const readBack = await enc.readFile("secret.md");
      assert.equal(new TextDecoder().decode(readBack), "secret data");

      const keys = Array.from(inner.store.keys());
      assert.ok(keys.length > 0);
      assert.notEqual(keys[0], "secret.md");
    });

    it("should cacheKey and then readFile after write", async () => {
      const inner = new InMemoryFs();
      const enc = new FakeFsEncrypt(inner, password, "openssl-base64");

      await enc.writeFileSingle(
        "a.md",
        new TextEncoder().encode("aaaa").buffer,
        10,
        5
      );
      await enc.cacheKey("b.md");
      await enc.writeFileSingle(
        "b.md",
        new TextEncoder().encode("bbbb").buffer,
        20,
        10
      );

      assert.equal(
        new TextDecoder().decode(await enc.readFile("a.md")),
        "aaaa"
      );
      assert.equal(
        new TextDecoder().decode(await enc.readFile("b.md")),
        "bbbb"
      );
    });
  });
});
