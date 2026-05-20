import { strict as assert } from "assert";
import type { Entity } from "../src/baseTypes";
import { FakeFs, type RemoteSnapshot } from "../src/fsAll";

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

  async checkRemoteChanges(): Promise<RemoteSnapshot | null> {
    return null;
  }
}

describe("FakeFs: rmBatch default implementation", () => {
  let fs: InMemoryFs;

  beforeEach(() => {
    fs = new InMemoryFs();
  });

  it("should delete a single file via rmBatch", async () => {
    await fs.writeFile("a.md", new ArrayBuffer(10), 100, 50);
    assert.ok(fs.store.has("a.md"));

    await fs.rmBatch(["a.md"]);
    assert.equal(fs.store.has("a.md"), false);
  });

  it("should delete multiple files via rmBatch", async () => {
    await fs.writeFile("a.md", new ArrayBuffer(10), 100, 50);
    await fs.writeFile("b.md", new ArrayBuffer(20), 200, 100);
    await fs.writeFile("c.md", new ArrayBuffer(30), 300, 150);
    assert.equal(fs.store.size, 3);

    await fs.rmBatch(["a.md", "c.md"]);
    assert.equal(fs.store.has("a.md"), false);
    assert.equal(fs.store.has("b.md"), true);
    assert.equal(fs.store.has("c.md"), false);
    assert.equal(fs.store.size, 1);
  });

  it("should handle empty keys array", async () => {
    await fs.writeFile("a.md", new ArrayBuffer(10), 100, 50);
    await fs.rmBatch([]);
    assert.equal(fs.store.size, 1);
  });

  it("should handle deleting already deleted keys silently", async () => {
    await fs.rmBatch(["nonexistent.md"]);
    assert.equal(fs.store.size, 0);
  });

  it("should delete folders via rmBatch", async () => {
    await fs.mkdir("folder/", 100, 50);
    assert.ok(fs.store.has("folder/"));

    await fs.rmBatch(["folder/"]);
    assert.equal(fs.store.has("folder/"), false);
  });

  it("should delete mixed files and folders", async () => {
    await fs.mkdir("dir/", 100, 50);
    await fs.writeFile("dir/a.md", new ArrayBuffer(10), 200, 100);
    await fs.writeFile("dir/b.md", new ArrayBuffer(20), 300, 150);

    await fs.rmBatch(["dir/a.md", "dir/"]);

    assert.equal(fs.store.has("dir/a.md"), false);
    assert.equal(fs.store.has("dir/b.md"), true);
    assert.equal(fs.store.has("dir/"), false);
  });
});
