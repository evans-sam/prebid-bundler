# Package.json Race Mutex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the race condition in [`src/server.ts`](../../../src/server.ts) where concurrent `/bundle/:version` requests mutate the shared version directory's `package.json` — by serializing the pkg.json-mutation + gulp-run window with a per-version async mutex.

**Architecture:** New standalone module `src/versionLock.ts` exports `withVersionLock(version, fn)`. `buildBundle` wraps its pkg.json write → spawn gulp → pkg.json restore window inside `withVersionLock`. Cross-version builds stay parallel; same-version builds serialize FIFO. No route handler changes.

**Tech Stack:** Bun runtime, `bun:test` for testing, TypeScript.

**Source spec:** [docs/superpowers/specs/2026-04-16-package-json-race-mutex-design.md](../specs/2026-04-16-package-json-race-mutex-design.md)

---

## File Structure

- **Create:** `src/versionLock.ts` — mutex primitive (~30 lines).
- **Create:** `src/versionLock.test.ts` — unit tests for the primitive.
- **Modify:** `src/server.ts` — import `withVersionLock`, wrap the pkg.json/spawn/restore window inside `buildBundle`.
- **Modify:** `src/server.test.ts` — add 4 integration tests at the end of the existing `describe("buildBundle")` block.

---

## Task 1: Create `versionLock.ts` skeleton with failing test

**Files:**
- Create: `src/versionLock.ts`
- Create: `src/versionLock.test.ts`

- [ ] **Step 1: Write failing test for sequential execution per version**

Create `src/versionLock.test.ts`:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { _resetLocksForTest, withVersionLock } from "./versionLock";

afterEach(() => {
  _resetLocksForTest();
});

describe("withVersionLock", () => {
  test("serializes concurrent calls for the same version", async () => {
    const events: string[] = [];

    const first = withVersionLock("10.20.0", async () => {
      events.push("first:start");
      await Bun.sleep(50);
      events.push("first:end");
      return "first-result";
    });

    const second = withVersionLock("10.20.0", async () => {
      events.push("second:start");
      await Bun.sleep(10);
      events.push("second:end");
      return "second-result";
    });

    const [r1, r2] = await Promise.all([first, second]);

    expect(r1).toBe("first-result");
    expect(r2).toBe("second-result");
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/versionLock.test.ts`

Expected: FAIL with "Cannot find module './versionLock'" (the import resolves nothing).

- [ ] **Step 3: Implement the mutex primitive**

Create `src/versionLock.ts`:

```ts
const tails = new Map<string, Promise<void>>();

export async function withVersionLock<T>(
  version: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = tails.get(version) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  const myTail = prev.then(() => mine);
  tails.set(version, myTail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(version) === myTail) {
      tails.delete(version);
    }
  }
}

// Test-only helper. Clears all locks so tests don't leak state between cases.
export function _resetLocksForTest(): void {
  tails.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/versionLock.test.ts`

Expected: PASS (1 test passing).

- [ ] **Step 5: Commit**

```bash
git add src/versionLock.ts src/versionLock.test.ts
git commit -m "feat(versionLock): add per-version async mutex primitive

Adds withVersionLock(version, fn) in a new module. Serializes calls
for the same version via a chained-promise queue; different versions
run concurrently. Includes a test verifying sequential ordering for
same-version calls.

Refs #22"
```

---

## Task 2: Verify cross-version parallelism

**Files:**
- Modify: `src/versionLock.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/versionLock.test.ts`, inside the `describe("withVersionLock", ...)` block:

```ts
  test("runs concurrently for different versions", async () => {
    const events: string[] = [];

    const a = withVersionLock("10.20.0", async () => {
      events.push("a:start");
      await Bun.sleep(50);
      events.push("a:end");
    });

    const b = withVersionLock("10.19.0", async () => {
      events.push("b:start");
      await Bun.sleep(50);
      events.push("b:end");
    });

    await Promise.all([a, b]);

    // Both starts must happen before either end: overlap proves parallelism.
    expect(events.indexOf("a:start")).toBeLessThan(events.indexOf("a:end"));
    expect(events.indexOf("b:start")).toBeLessThan(events.indexOf("a:end"));
    expect(events.indexOf("a:start")).toBeLessThan(events.indexOf("b:end"));
  });
```

- [ ] **Step 2: Run to verify it passes immediately**

Run: `bun test src/versionLock.test.ts`

Expected: PASS (both tests pass — the primitive already supports this; this test locks the behavior in).

- [ ] **Step 3: Commit**

```bash
git add src/versionLock.test.ts
git commit -m "test(versionLock): verify cross-version parallelism"
```

---

## Task 3: Test release on rejection

**Files:**
- Modify: `src/versionLock.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe` block:

```ts
  test("releases the lock when fn rejects so next acquirer proceeds", async () => {
    const first = withVersionLock("v1", async () => {
      throw new Error("boom");
    });

    await expect(first).rejects.toThrow("boom");

    const second = withVersionLock("v1", async () => "ok");
    expect(await second).toBe("ok");
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `bun test src/versionLock.test.ts`

Expected: PASS. The `finally` block in the primitive already releases on rejection; this test pins that behavior.

- [ ] **Step 3: Commit**

```bash
git add src/versionLock.test.ts
git commit -m "test(versionLock): verify lock releases on rejection"
```

---

## Task 4: Test release on synchronous throw

**Files:**
- Modify: `src/versionLock.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe` block:

```ts
  test("releases the lock when fn throws synchronously", async () => {
    const first = withVersionLock("v1", (): Promise<never> => {
      throw new Error("sync-boom");
    });

    await expect(first).rejects.toThrow("sync-boom");

    const second = withVersionLock("v1", async () => "ok");
    expect(await second).toBe("ok");
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `bun test src/versionLock.test.ts`

Expected: PASS. `await fn()` inside a `try`/`finally` catches synchronous throws too, so the release still fires.

- [ ] **Step 3: Commit**

```bash
git add src/versionLock.test.ts
git commit -m "test(versionLock): verify lock releases on sync throw"
```

---

## Task 5: Test FIFO ordering

**Files:**
- Modify: `src/versionLock.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe` block:

```ts
  test("queued acquirers for the same version run in FIFO order", async () => {
    const started: number[] = [];

    const promises: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        withVersionLock("v1", async () => {
          started.push(i);
          await Bun.sleep(5);
        }),
      );
    }

    await Promise.all(promises);

    expect(started).toEqual([0, 1, 2, 3, 4]);
  });
```

- [ ] **Step 2: Run to verify it passes**

Run: `bun test src/versionLock.test.ts`

Expected: PASS. Chained-promise queue gives natural FIFO.

- [ ] **Step 3: Commit**

```bash
git add src/versionLock.test.ts
git commit -m "test(versionLock): verify FIFO acquisition order"
```

---

## Task 6: Test map cleanup

**Files:**
- Modify: `src/versionLock.ts`
- Modify: `src/versionLock.test.ts`

- [ ] **Step 1: Export an internal size probe for tests**

Edit `src/versionLock.ts`. Append at the end of the file:

```ts
// Test-only helper. Returns the number of currently-tracked versions so
// tests can verify cleanup. Do not use outside tests.
export function _lockCountForTest(): number {
  return tails.size;
}
```

- [ ] **Step 2: Add the failing test**

Append inside the `describe` block in `src/versionLock.test.ts`. Also add the import at the top — update the existing import line:

```ts
import { _lockCountForTest, _resetLocksForTest, withVersionLock } from "./versionLock";
```

Test:

```ts
  test("releases map entry after last holder finishes", async () => {
    expect(_lockCountForTest()).toBe(0);

    await withVersionLock("v1", async () => {
      expect(_lockCountForTest()).toBe(1);
    });

    expect(_lockCountForTest()).toBe(0);
  });
```

- [ ] **Step 3: Run to verify it passes**

Run: `bun test src/versionLock.test.ts`

Expected: PASS. `tails.delete(version)` fires when `tails.get(version) === myTail` (no one chained behind us).

- [ ] **Step 4: Commit**

```bash
git add src/versionLock.ts src/versionLock.test.ts
git commit -m "test(versionLock): verify map cleanup after last release"
```

---

## Task 7: Wrap `buildBundle` pkg.json/spawn window with the mutex

**Files:**
- Modify: `src/server.ts` (lines 217–316 area — specifically the globalVarName-set + spawn + finally-restore window)

- [ ] **Step 1: Write a failing integration test for concurrent same-version different globalVarName**

Add this test at the end of the existing `describe("buildBundle", ...)` block in `src/server.test.ts`. (Find the block that starts around line 577 with `describe("buildBundle", ...)`. Insert the new tests just before its closing `});`.)

Also add a helper at the top of that describe block, right after the existing `beforeAll`/`afterAll`, that produces a delayed mock spawn which captures the pkg.json globalVarName mid-build:

```ts
  // Helper: mock spawn that waits `delayMs` then reads pkg.json and calls
  // the capture callback with the globalVarName it saw. Creates a mock
  // output file so buildBundle succeeds.
  function makeCapturingSpawn(
    versionDir: string,
    onCapture: (value: unknown) => void,
    delayMs = 100,
  ) {
    return (_cmd: string[], opts: MockSpawnOpts = {}) => {
      const buildDirPath = opts.env?.PREBID_DIST_PATH;
      return {
        exited: (async () => {
          await Bun.sleep(delayMs);
          const pkgJson = await Bun.file(join(versionDir, "package.json")).json();
          onCapture(pkgJson.globalVarName);
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({ start: (c) => c.close() }),
        stderr: new ReadableStream({ start: (c) => c.close() }),
        kill: () => {},
        pid: 12345,
      };
    };
  }
```

Now the test itself:

```ts
  test("serializes concurrent builds for the same version with different globalVarName", async () => {
    const localFixture = await createTestFixture();
    const versionDir = await createVersionFixture(localFixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "pbjs",
    });

    const captured: Record<string, unknown> = {};

    const configA: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: makeCapturingSpawn(versionDir, (v) => {
        captured.a = v;
      }) as unknown as typeof Bun.spawn,
    };

    const configB: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: makeCapturingSpawn(versionDir, (v) => {
        captured.b = v;
      }) as unknown as typeof Bun.spawn,
    };

    const [, ] = await Promise.all([
      buildBundle({ config: configA, version: "10.20.0", modules: ["testModule"], globalVarName: "varA" }),
      buildBundle({ config: configB, version: "10.20.0", modules: ["testModule"], globalVarName: "varB" }),
    ]);

    expect(captured.a).toBe("varA");
    expect(captured.b).toBe("varB");

    const finalPkgJson = await Bun.file(join(versionDir, "package.json")).json();
    expect(finalPkgJson.globalVarName).toBe("pbjs");

    await localFixture.cleanup();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/server.test.ts`

Expected: FAIL on the new test. Either `captured.a === "varB"` or `captured.b === "varA"` (or some corruption of the final pkg.json) — the race is present, so at least one of the assertions should trip.

Note: bun's event loop may interleave favorably on some machines. If the test passes by luck, increase the `delayMs` parameter in the second call to 150 so the overlap is wider, and/or increase to four concurrent builds. The race must be reproducible before proceeding.

- [ ] **Step 3: Add the import of `withVersionLock` at the top of `src/server.ts`**

Edit the imports section at the top of `src/server.ts` (currently ends near line 6). Add this line after the `parseVersion` import:

```ts
import { withVersionLock } from "./versionLock.ts";
```

- [ ] **Step 4: Wrap the pkg.json/spawn/restore window in `buildBundle`**

In `src/server.ts`, locate `buildBundle` (starts around line 217). Currently the flow after Phase 1 validation is:

1. Phase 1.5: `setGlobalVarName` if provided (line ~234–237)
2. Phase 2: `mkdir` build dir (line ~240–243)
3. Phase 3: spawn gulp, timeout race, `finally { restoreGlobalVarName }` (line ~246–278)

Restructure so the pkg.json write, spawn, and restore happen **inside** `withVersionLock`. The build dir creation can stay where it is — it's per-build and doesn't depend on pkg.json state. Replace the block from the `// Phase 1.5: Set globalVarName...` comment through to the `mark(ctx, "gulp:end");` line (roughly lines 233–279) with:

```ts
  // Phase 2: Directory setup (unlocked — per-build isolated)
  mark(ctx, "dirSetup:start");
  const buildDir = join(config.buildsDir, buildId);
  await mkdir(buildDir, { recursive: true });
  mark(ctx, "dirSetup:end");

  // Phase 3: Serialized pkg.json mutation + gulp build (per-version mutex)
  // All builds of the same version take the lock, even those without
  // globalVarName: gulp reads pkg.json at startup, so a concurrent
  // mutating build could otherwise leak its transient value into us.
  const { exitCode, stderr } = await withVersionLock(version, async () => {
    let originalGlobalVarName: string | undefined;
    if (globalVarName) {
      originalGlobalVarName = await setGlobalVarName(versionDir, globalVarName);
    }

    try {
      mark(ctx, "gulp:start");
      const modulesArg = modules.join(",");
      const gulpCommand = globalVarName ? "build" : "bundle";
      const proc = spawn(["npx", "gulp", gulpCommand, `--modules=${modulesArg}`], {
        cwd: versionDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PREBID_DIST_PATH: buildDir,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          proc.kill();
          reject(new Error(`Build timed out after ${config.buildTimeoutMs}ms`));
        }, config.buildTimeoutMs);
      });

      const code = await Promise.race([proc.exited, timeoutPromise]);
      mark(ctx, "gulp:end");

      // Read stderr inside the locked region so the proc's streams are
      // still attached. If exit was non-zero we need the text later.
      const stderrText = code !== 0 ? await new Response(proc.stderr).text() : "";
      return { exitCode: code, stderr: stderrText };
    } finally {
      if (originalGlobalVarName !== undefined) {
        await restoreGlobalVarName(versionDir, originalGlobalVarName);
      }
    }
  }).catch(async (error) => {
    // If the locked section threw (timeout, spawn error, restore error),
    // clear timings and clean the build dir before rethrowing.
    clearTimings(ctx);
    await cleanupBuildDir(buildDir, buildId);
    throw error;
  });

  if (exitCode !== 0) {
    clearTimings(ctx);
    await cleanupBuildDir(buildDir, buildId);
    throw new Error(`Build failed: ${stderr}`);
  }
```

After this block, the existing code from `// Find the built file` onward stays unchanged.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `bun test src/server.test.ts`

Expected: PASS — including the new serialization test. `captured.a === "varA"`, `captured.b === "varB"`, final pkg.json restored to `"pbjs"`.

- [ ] **Step 6: Run the full test suite to verify no regression**

Run: `bun test`

Expected: ALL tests pass. Existing `buildBundle` tests — gulp command, non-existent version, build failure, timeout, dedup, `globalVarName` pkg.json modify+restore, timeout with globalVarName — must continue to pass.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/server.test.ts
git commit -m "fix(server): serialize per-version pkg.json mutation with mutex

Wraps the globalVarName set/spawn/restore window in buildBundle with
withVersionLock. Eliminates the race where concurrent /bundle/:version
requests with different globalVarName values could stomp on each
other's pkg.json writes. Cross-version builds remain parallel.

Fixes #22"
```

---

## Task 8: Integration test — restore-on-failure path under contention

**Files:**
- Modify: `src/server.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe("buildBundle", ...)` block, after the Task 7 test:

```ts
  test("first build timeout releases the mutex so the queued build proceeds with correct globalVarName", async () => {
    const localFixture = await createTestFixture();
    const versionDir = await createVersionFixture(localFixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "pbjs",
    });

    // Build 1: gulp that never exits — will time out.
    const neverExitSpawn = (_cmd: string[], _opts: MockSpawnOpts = {}) => ({
      exited: new Promise<number>(() => {}),
      stdout: new ReadableStream({ start: (c) => c.close() }),
      stderr: new ReadableStream({ start: (c) => c.close() }),
      kill: () => {},
      pid: 12345,
    });

    let capturedForBuild2: unknown;
    const captureSpawn = makeCapturingSpawn(versionDir, (v) => {
      capturedForBuild2 = v;
    });

    const config1: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 150,
      spawn: neverExitSpawn as unknown as typeof Bun.spawn,
    };

    const config2: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: captureSpawn as unknown as typeof Bun.spawn,
    };

    const build1 = buildBundle({ config: config1, version: "10.20.0", modules: ["testModule"], globalVarName: "willTimeout" });
    const build2 = buildBundle({ config: config2, version: "10.20.0", modules: ["testModule"], globalVarName: "afterTimeout" });

    await expect(build1).rejects.toThrow("Build timed out after 150ms");
    await build2;

    expect(capturedForBuild2).toBe("afterTimeout");

    const finalPkgJson = await Bun.file(join(versionDir, "package.json")).json();
    expect(finalPkgJson.globalVarName).toBe("pbjs");

    await localFixture.cleanup();
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test src/server.test.ts`

Expected: PASS. Build 1 times out, its `finally` restores pkg.json to `"pbjs"`, mutex releases, build 2 takes the lock, sees `"pbjs"` as its captured original, injects `"afterTimeout"`, gulp sees it, then restores to `"pbjs"`.

- [ ] **Step 3: Commit**

```bash
git add src/server.test.ts
git commit -m "test(server): verify pkg.json restore on timeout under contention"
```

---

## Task 9: Integration test — different versions run in parallel

**Files:**
- Modify: `src/server.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe("buildBundle", ...)` block:

```ts
  test("builds for different versions run concurrently (no cross-version blocking)", async () => {
    const localFixture = await createTestFixture();
    const versionDirA = await createVersionFixture(localFixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "pbjs",
    });
    const versionDirB = await createVersionFixture(localFixture.prebidDir, "10.19.0", ["testModule"], {
      name: "prebid.js",
      version: "10.19.0",
      globalVarName: "pbjs",
    });

    const slowSpawn = (versionDir: string) => (_cmd: string[], opts: MockSpawnOpts = {}) => {
      const buildDirPath = opts.env?.PREBID_DIST_PATH;
      return {
        exited: (async () => {
          await Bun.sleep(100);
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({ start: (c) => c.close() }),
        stderr: new ReadableStream({ start: (c) => c.close() }),
        kill: () => {},
        pid: 12345,
      };
    };

    const configA: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: slowSpawn(versionDirA) as unknown as typeof Bun.spawn,
    };

    const configB: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: slowSpawn(versionDirB) as unknown as typeof Bun.spawn,
    };

    const start = performance.now();
    await Promise.all([
      buildBundle({ config: configA, version: "10.20.0", modules: ["testModule"], globalVarName: "varA" }),
      buildBundle({ config: configB, version: "10.19.0", modules: ["testModule"], globalVarName: "varB" }),
    ]);
    const elapsed = performance.now() - start;

    // Parallel => ~100ms. Serialized => ~200ms. Slack for CI jitter.
    expect(elapsed).toBeLessThan(180);

    await localFixture.cleanup();
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test src/server.test.ts`

Expected: PASS. Two different-version builds run simultaneously, total elapsed < 180 ms.

Note: if the CI host is very slow and this test flakes, widen the threshold to 220 ms. Do not raise it further without investigating — if elapsed ≥ 300 ms there is actual cross-version serialization happening.

- [ ] **Step 3: Commit**

```bash
git add src/server.test.ts
git commit -m "test(server): verify builds for different versions run in parallel"
```

---

## Task 10: Integration test — non-mutating build also queues behind mutating one

**Files:**
- Modify: `src/server.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe("buildBundle", ...)` block:

```ts
  test("same-version build without globalVarName still waits for in-flight mutating build", async () => {
    const localFixture = await createTestFixture();
    const versionDir = await createVersionFixture(localFixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "pbjs",
    });

    const events: string[] = [];

    // Build 1: slow, mutates pkg.json via globalVarName.
    const slowMutatingSpawn = (_cmd: string[], opts: MockSpawnOpts = {}) => {
      const buildDirPath = opts.env?.PREBID_DIST_PATH;
      return {
        exited: (async () => {
          events.push("build1:gulp-start");
          await Bun.sleep(100);
          events.push("build1:gulp-end");
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle 1");
          }
          return 0;
        })(),
        stdout: new ReadableStream({ start: (c) => c.close() }),
        stderr: new ReadableStream({ start: (c) => c.close() }),
        kill: () => {},
        pid: 12345,
      };
    };

    // Build 2: no globalVarName, fast spawn.
    const fastSpawn = (_cmd: string[], opts: MockSpawnOpts = {}) => {
      const buildDirPath = opts.env?.PREBID_DIST_PATH;
      return {
        exited: (async () => {
          events.push("build2:gulp-start");
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle 2");
          }
          events.push("build2:gulp-end");
          return 0;
        })(),
        stdout: new ReadableStream({ start: (c) => c.close() }),
        stderr: new ReadableStream({ start: (c) => c.close() }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config1: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: slowMutatingSpawn as unknown as typeof Bun.spawn,
    };

    const config2: ServerConfig = {
      prebidDir: localFixture.prebidDir,
      buildsDir: localFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: fastSpawn as unknown as typeof Bun.spawn,
    };

    await Promise.all([
      buildBundle({ config: config1, version: "10.20.0", modules: ["testModule"], globalVarName: "mutator" }),
      buildBundle({ config: config2, version: "10.20.0", modules: ["testModule"] }),
    ]);

    // build2's gulp must start only after build1's gulp ends (mutex enforces ordering).
    expect(events.indexOf("build2:gulp-start")).toBeGreaterThan(events.indexOf("build1:gulp-end"));

    await localFixture.cleanup();
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test src/server.test.ts`

Expected: PASS. The event sequence shows `build1:gulp-start`, `build1:gulp-end`, then `build2:gulp-start`, `build2:gulp-end`.

- [ ] **Step 3: Commit**

```bash
git add src/server.test.ts
git commit -m "test(server): verify non-mutating build waits behind mutating one"
```

---

## Task 11: Final full-suite run and lint

**Files:** (no code changes)

- [ ] **Step 1: Run the entire test suite**

Run: `bun test`

Expected: ALL tests pass, including the four new integration tests (Tasks 7–10) and the six new primitive unit tests (Tasks 1–6).

- [ ] **Step 2: Run the linter**

Run: `bun run lint`

Expected: zero warnings or errors. If Biome flags style on the new files, fix inline and commit with `style: biome autofixes`.

- [ ] **Step 3: Run formatting check**

Run: `bun run format`

Expected: no changes, or autofix-and-commit if any.

- [ ] **Step 4: Confirm acceptance criteria**

Cross-reference against issue #22 acceptance criteria:

- [x] No code path mutates the shared version directory's `package.json` per request, OR access is serialized → **serialized via `withVersionLock`**.
- [x] Test fires two concurrent requests with different `globalVarName`s and verifies each gets the right output → **Task 7 test**.
- [x] Restore-on-failure path remains correct → **Task 8 test covers timeout+restore under contention; existing `restores package.json on timeout` test still passes**.

- [ ] **Step 5: Final commit if any lint/format fixes were made**

```bash
git add -A
git commit -m "style: biome autofixes for mutex changes"
```

(Skip if nothing to commit.)

---

## Out of scope (per spec)

- The pre-existing bug where `restoreGlobalVarName` skips restoration when the base `package.json` had no `globalVarName` field. Separate issue.
- Multi-process lock coordination.
- Upstream change to Prebid gulpfile to accept `globalVarName` via CLI/env.
