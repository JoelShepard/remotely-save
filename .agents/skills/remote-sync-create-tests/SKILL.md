---
name: remote-sync-create-tests
description: "Create comprehensive tests for newly implemented features in the Remote Sync Obsidian plugin, following the project's existing test patterns (mocha + chai, strict assert, InMemoryFs for FS tests)."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Remote Sync — Create Tests for Implemented Features

> Workflow for creating tests that cover features implemented via the TODO → PRD → Implementation workflow.

## When to Use This Skill

Use this skill when:

- A feature has been implemented and tests need to be written to cover it
- The user asks "write tests for X" or "test this feature"
- You're doing the TODO → PRD → Implementation ⇄ Test (loop) workflow and are at the Test phase

---

## 0. Understand the Feature

Before writing tests, always understand what was implemented:

1. **Read the PRD** (`docs/PDR-*.md`) — Understand the requirements, acceptance criteria, and success metrics.
2. **Read the source files** — Understand the exported API, class methods, interfaces, and edge cases.
3. **Identify testable units** — Pure functions, classes with clear input/output, FS operations with mock backend, state transitions.

---

## 1. Test File Conventions

### 1.1 Location and Naming

```
tests/<feature-name>.test.ts
```

Use `camelCase` or `kebab-case` matching the source file name. Examples:
- `tests/misc.test.ts` → tests for `src/misc.ts`
- `tests/encryptOpenSSL.test.ts` → tests for `src/encryptOpenSSL.ts`
- `tests/fsEncrypt.test.ts` → tests for `src/fsEncrypt.ts`
- `tests/configPersist.test.ts` → tests for `src/configPersist.ts`

### 1.2 File Template

```typescript
import { strict as assert } from "assert";
// Import the module under test
import { yourFunction, YourClass } from "../src/yourModule";
// Import any test utilities (mocks, helpers)
import { FakeFs } from "../src/fsAll";
// Import types as needed
import type { Entity } from "../src/baseTypes";

// Required for browser-only APIs (webcrypto, etc.)
if (typeof globalThis.self === "undefined") {
  (globalThis as any).self = globalThis;
}

describe("YourModule: what it does", () => {
  // beforeEach for setting up global mocks
  beforeEach(() => {
    global.window = {
      crypto: require("crypto").webcrypto,
    } as any;
  });

  it("should do the basic thing", () => {
    // Arrange
    const input = "...";
    // Act
    const result = yourFunction(input);
    // Assert
    assert.equal(result, expected);
  });

  it("should handle edge case X", () => {
    // ...
  });

  it("should throw on invalid input", () => {
    assert.throws(() => yourFunction("bad"), /expected error message/);
  });
});
```

---

## 2. Testing Patterns

### 2.1 Pure Function Tests

For utility functions in `misc.ts`, `configPersist.ts`, etc.:

```typescript
import * as misc from "../src/misc";

describe("Misc: your feature", () => {
  it("should return correct result for normal input", () => {
    assert.equal(misc.yourFunction("input"), "expected");
  });

  it("should handle empty input", () => {
    assert.equal(misc.yourFunction(""), "expected");
  });

  it("should handle edge case X", () => {
    // Use assert.ok, assert.equal, assert.throws, assert.rejects
  });
});
```

**Assertion methods used in this project:**
- `assert.equal(actual, expected)`
- `assert.deepEqual(actual, expected)` — for objects/arrays
- `assert.ok(value)` — truthy
- `assert.throws(fn, /regex/)` — synchronous error
- `assert.rejects(asyncFn, /regex/)` — async error (use `await`)
- `assert.notEqual(a, b)`
- `assert.strictEqual(actual, expected)` when needed

### 2.2 FS Adapter Tests (InMemoryFs)

For testing `FakeFs` subclasses or the encryption wrapper `FakeFsEncrypt`, use the `InMemoryFs` mock:

```typescript
import { FakeFs } from "../src/fsAll";
import { FakeFsEncrypt } from "../src/fsEncrypt";
import type { Entity } from "../src/baseTypes";

// Define an in-memory FS for testing
class InMemoryFs extends FakeFs {
  kind: "mock-memory";
  store: Map<string, { content: ArrayBuffer; mtime: number; ctime: number }>;

  constructor() {
    super();
    this.kind = "mock-memory";
    this.store = new Map();
  }

  // Implement all abstract methods from FakeFs:
  async walk(): Promise<Entity[]> { /* ... */ }
  async walkPartial(): Promise<Entity[]> { /* ... */ }
  async stat(key: string): Promise<Entity> { /* ... */ }
  async mkdir(key: string, mtime?: number, ctime?: number): Promise<Entity> { /* ... */ }
  async writeFile(key: string, content: ArrayBuffer, mtime: number, ctime: number): Promise<Entity> { /* ... */ }
  async readFile(key: string): Promise<ArrayBuffer> { /* ... */ }
  async rename(key1: string, key2: string): Promise<void> { /* ... */ }
  async rm(key: string): Promise<void> { /* ... */ }
  async checkConnect(): Promise<boolean> { return true; }
  async getUserDisplayName(): Promise<string> { return "mock-user"; }
  async revokeAuth(): Promise<void> {}
  allowEmptyFile(): boolean { return true; }
}
```

**Key patterns:**
- Wrap each test in `describe("feature")` and `it("should ...")`
- Create a fresh `InMemoryFs` and wrapper instance in each test (no shared state)
- For encryption tests, set `global.window.crypto` in `beforeEach`
- Test round-trips: write → read back → assert equality
- Test error cases: invalid keys, missing files, wrong passwords
- Test edge cases: empty files, folders, special characters in paths

### 2.3 SyncTracer Tests

For the `SyncTracer` (from PRD better debugging):

```typescript
import { SyncTracer } from "../src/syncTracer";

describe("SyncTracer", () => {
  it("should record ops in order", () => {
    const tracer = new SyncTracer();
    const syncId = tracer.beginSync("manual");
    tracer.recordPhase("walk_local");
    tracer.recordApiCall("ListObjectsV2", 150, { key: "bucket" });
    const result = tracer.endSync();

    assert.ok(result.syncId);
    assert.equal(result.ops.length, 3); // sync_start + walk_local + ListObjectsV2
    assert.equal(result.ops[0].type, "phase");
    assert.equal(result.ops[0].label, "sync_start");
  });

  it("should produce waterfall text", () => {
    // Arrange
    const tracer = new SyncTracer();
    tracer.beginSync("manual");
    tracer.recordPhase("test");
    tracer.endSync();
    // Act
    const text = tracer.getWaterfallText();
    // Assert
    assert.ok(text.includes("Sync Trace:"));
    assert.ok(text.includes("test"));
  });

  it("should handle empty trace gracefully", () => {
    const tracer = new SyncTracer();
    assert.equal(tracer.getWaterfallText(), "No trace data.");
  });
});
```

### 2.4 LogManager Tests

For `logManager.ts`:

```typescript
import { startLogInterception, stopLogInterception, getLogs, clearLogs, getLogsAsText } from "../src/logManager";
import type { LogEntry } from "../src/logManager";

describe("LogManager", () => {
  beforeEach(() => {
    clearLogs();
  });

  afterEach(() => {
    stopLogInterception();
  });

  it("should capture console.log calls", () => {
    startLogInterception();
    console.info("test message");
    const logs = getLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, "info");
    assert.ok(logs[0].message.includes("test message"));
  });

  it("should filter by level", () => {
    startLogInterception();
    console.info("info msg");
    console.error("error msg");
    const errors = getLogs("error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].level, "error");
  });
});
```

### 2.5 State/DB Tests

For functions in `localdb.ts` that interact with IndexedDB via localforage:

```typescript
import { addErrorRecord, getErrorRecords, clearErrorRecords } from "../src/localdb";
import { prepareDBs } from "../src/localdb";

describe("Error History", () => {
  let db: any;
  let vaultRandomID: string;

  before(async () => {
    const result = await prepareDBs("/tmp/test-vault", "", "s3-default-1");
    db = result.db;
    vaultRandomID = result.vaultRandomID;
  });

  it("should store and retrieve error records", async () => {
    await addErrorRecord(db, vaultRandomID, {
      timestamp: Date.now(),
      category: "network",
      message: "Connection timeout",
      syncId: "test-sync-1",
    });

    const records = await getErrorRecords(db, vaultRandomID);
    assert.equal(records.length, 1);
    assert.equal(records[0].category, "network");
  });

  it("should clear all records", async () => {
    await addErrorRecord(db, vaultRandomID, { 
      timestamp: Date.now(), category: "internal", message: "test" 
    });
    await clearErrorRecords(db, vaultRandomID);
    const records = await getErrorRecords(db, vaultRandomID);
    assert.equal(records.length, 0);
  });
});
```

---

## 3. What to Test

For every new feature, write tests covering these dimensions:

| Dimension | What to check |
|-----------|---------------|
| **Happy path** | The basic functionality works as expected |
| **Edge cases** | Empty strings, zero values, null/undefined inputs, single-item lists |
| **Error handling** | Invalid inputs throw the right errors with descriptive messages |
| **Round-trips** | Write → Read back → Original data is intact |
| **Idempotency** | Calling the same operation twice produces the same result (or doesn't break) |
| **Boundaries** | Max/min values, empty collections, large inputs |
| **State isolation** | Each operation doesn't leak state into subsequent operations |

### 3.1 Prioritization

| Priority | When to Write |
|----------|---------------|
| HIGH | Happy path + main error handling — these prove the feature works |
| MEDIUM | Edge cases and boundary conditions — these prevent regressions |
| LOW | Performance, stress testing, exotic edge cases — nice to have |

---

## 4. Running Tests

```bash
npm run test        # Run all tests with mocha
npx mocha --file tests/setup.ts --import=tsx 'tests/**/*.ts'  # Same as npm test
npx mocha --file tests/setup.ts --import=tsx 'tests/yourTest.test.ts'  # Single test file
npx mocha --file tests/setup.ts --import=tsx 'tests/**/*.ts' --grep "pattern"  # Filter by test name
```

---

## 5. Test Quality Checklist

Before considering tests complete, verify:

- [ ] All tests pass (`npm run test`)
- [ ] No TypeScript errors (`npx tsc --noEmit --skipLibCheck`)
- [ ] Code is formatted (`npm run format` produces no changes)
- [ ] Tests cover the happy path
- [ ] Tests cover at least one error/edge case
- [ ] Tests are independent (no shared mutable state between `it()` blocks)
- [ ] Mock objects (`InMemoryFs`, etc.) are created fresh per test (or per `describe` if read-only)
- [ ] No test leaks side effects (stopLogInterception, clearLogs, etc. in `afterEach`)
- [ ] Test names describe what's being verified (e.g., "should return error for missing bucket")
- [ ] Tests use `assert` from `node:assert` (strict mode) — not `chai` unless the rest of the file already uses it

---

## 6. Example: Complete Test Suite for a New Feature

Suppose you implemented a `Debouncer` class in `src/debouncer.ts`:

```typescript
// tests/debouncer.test.ts
import { strict as assert } from "assert";
import { Debouncer } from "../src/debouncer";

describe("Debouncer", () => {
  it("should call the function after the delay", (done) => {
    const debouncer = new Debouncer(50);
    let called = false;
    debouncer.debounce(() => {
      called = true;
    });
    assert.equal(called, false);
    setTimeout(() => {
      assert.equal(called, true);
      done();
    }, 100);
  });

  it("should cancel the previous call on new invocation", (done) => {
    const debouncer = new Debouncer(50);
    let callCount = 0;
    debouncer.debounce(() => { callCount++; });
    debouncer.debounce(() => { callCount++; });
    setTimeout(() => {
      assert.equal(callCount, 1);
      done();
    }, 100);
  });

  it("should handle zero delay", (done) => {
    const debouncer = new Debouncer(0);
    let called = false;
    debouncer.debounce(() => { called = true; });
    setTimeout(() => {
      assert.equal(called, true);
      done();
    }, 10);
  });

  it("should flush pending calls", () => {
    const debouncer = new Debouncer(1000);
    let called = false;
    debouncer.debounce(() => { called = true; });
    debouncer.flush();
    assert.equal(called, true);
  });
});
```
