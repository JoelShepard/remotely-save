import { strict as assert } from "assert";
import {
  entityEquals,
  localChangeStatEquals,
  remoteManifestStatEquals,
} from "../src/syncEngine";

if (typeof globalThis.self === "undefined") {
  (globalThis as any).self = globalThis;
}

describe("syncEngine: remoteManifestStatEquals", () => {
  it("should return false when either side is null", () => {
    assert.equal(remoteManifestStatEquals(null, null), false);
    assert.equal(
      remoteManifestStatEquals({ etag: '"a"', lastModified: 1, size: 2 }, null),
      false
    );
  });

  it("should return true when etag, mtime, and size all match", () => {
    assert.equal(
      remoteManifestStatEquals(
        { etag: '"a"', lastModified: 1, size: 2 },
        { etag: '"a"', lastModified: 1, size: 2 }
      ),
      true
    );
  });

  it("should return false when any field differs", () => {
    assert.equal(
      remoteManifestStatEquals(
        { etag: '"a"', lastModified: 1, size: 2 },
        { etag: '"b"', lastModified: 1, size: 2 }
      ),
      false
    );
    assert.equal(
      remoteManifestStatEquals(
        { etag: '"a"', lastModified: 1, size: 2 },
        { etag: '"a"', lastModified: 2, size: 2 }
      ),
      false
    );
    assert.equal(
      remoteManifestStatEquals(
        { etag: '"a"', lastModified: 1, size: 2 },
        { etag: '"a"', lastModified: 1, size: 3 }
      ),
      false
    );
  });
});

describe("syncEngine: localChangeStatEquals", () => {
  it("should return false when either side is null", () => {
    assert.equal(localChangeStatEquals(null, null), false);
    assert.equal(
      localChangeStatEquals(
        { fileCount: 1, newestMtime: 2, pathHash: "abc" },
        null
      ),
      false
    );
  });

  it("should return true when file count, mtime, and hash all match", () => {
    assert.equal(
      localChangeStatEquals(
        { fileCount: 1, newestMtime: 2, pathHash: "abc" },
        { fileCount: 1, newestMtime: 2, pathHash: "abc" }
      ),
      true
    );
  });

  it("should return false when any field differs", () => {
    assert.equal(
      localChangeStatEquals(
        { fileCount: 1, newestMtime: 2, pathHash: "abc" },
        { fileCount: 2, newestMtime: 2, pathHash: "abc" }
      ),
      false
    );
    assert.equal(
      localChangeStatEquals(
        { fileCount: 1, newestMtime: 2, pathHash: "abc" },
        { fileCount: 1, newestMtime: 3, pathHash: "abc" }
      ),
      false
    );
    assert.equal(
      localChangeStatEquals(
        { fileCount: 1, newestMtime: 2, pathHash: "abc" },
        { fileCount: 1, newestMtime: 2, pathHash: "def" }
      ),
      false
    );
  });
});

describe("syncEngine: entityEquals with ETag", () => {
  it("should return true when both undefined", () => {
    assert.equal(entityEquals(undefined, undefined), true);
  });

  it("should return false when one is undefined", () => {
    assert.equal(
      entityEquals({ keyRaw: "a.md", sizeRaw: 100 }, undefined),
      false
    );
    assert.equal(
      entityEquals(undefined, { keyRaw: "a.md", sizeRaw: 100 }),
      false
    );
  });

  it("should return true when both have same mtime and size", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    assert.equal(entityEquals(a, b), true);
  });

  it("should return false when mtime differs", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 2000 };
    assert.equal(entityEquals(a, b), false);
  });

  it("should return false when size differs", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    const b = { keyRaw: "a.md", sizeRaw: 200, mtimeCli: 1000 };
    assert.equal(entityEquals(a, b), false);
  });

  it("should return true when both have matching ETag regardless of mtime/size", () => {
    const a = {
      keyRaw: "a.md",
      sizeRaw: 100,
      mtimeCli: 1000,
      etag: '"abc123"',
    };
    const b = {
      keyRaw: "a.md",
      sizeRaw: 200,
      mtimeCli: 2000,
      etag: '"abc123"',
    };
    assert.equal(entityEquals(a, b), true);
  });

  it("should fall back to mtime+size when ETags differ", () => {
    const a = {
      keyRaw: "a.md",
      sizeRaw: 100,
      mtimeCli: 1000,
      etag: '"abc123"',
    };
    const b = {
      keyRaw: "a.md",
      sizeRaw: 100,
      mtimeCli: 1000,
      etag: '"def456"',
    };
    // When ETags differ, falls back to mtime+size; if both match, entities are equal
    assert.equal(entityEquals(a, b), true);
  });

  it("should return false when ETags differ AND mtime differs", () => {
    const a = {
      keyRaw: "a.md",
      sizeRaw: 100,
      mtimeCli: 1000,
      etag: '"abc123"',
    };
    const b = {
      keyRaw: "a.md",
      sizeRaw: 100,
      mtimeCli: 2000,
      etag: '"def456"',
    };
    assert.equal(entityEquals(a, b), false);
  });

  it("should fall back to mtime+size when only one side has ETag", () => {
    const a = {
      keyRaw: "a.md",
      sizeRaw: 100,
      mtimeCli: 1000,
      etag: '"abc123"',
    };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 2000 };
    assert.equal(entityEquals(a, b), false);
  });

  it("should fall back to mtime+size when both have no ETag", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    assert.equal(entityEquals(a, b), true);
  });

  it("should use mtimeSvr fallback if mtimeCli is undefined", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeSvr: 1000 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeSvr: 1000 };
    assert.equal(entityEquals(a, b), true);
  });

  it("should prefer mtimeCli over mtimeSvr", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000, mtimeSvr: 999 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000, mtimeSvr: 888 };
    assert.equal(entityEquals(a, b), true);
  });

  it("should use sizeRaw fallback if size is undefined", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1000 };
    assert.equal(entityEquals(a, b), true);
  });

  it("should treat sub-second mtime differences as equal (S3 precision)", () => {
    // S3 LastModified has second precision; local filesystem has ms precision.
    // Values in the same second should be considered equal.
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1716153600123 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1716153600000 };
    assert.equal(entityEquals(a, b), true);
  });

  it("should still detect cross-second mtime differences", () => {
    // Different seconds should still be different
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1716153600000 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeCli: 1716153601000 };
    assert.equal(entityEquals(a, b), false);
  });

  it("should treat sub-second mtimeSvr differences as equal", () => {
    const a = { keyRaw: "a.md", sizeRaw: 100, mtimeSvr: 1716153600123 };
    const b = { keyRaw: "a.md", sizeRaw: 100, mtimeSvr: 1716153600000 };
    assert.equal(entityEquals(a, b), true);
  });
});
