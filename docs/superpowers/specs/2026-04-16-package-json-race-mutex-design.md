# Fix: Race Condition in Concurrent `package.json` Mutation

**Issue:** [#22 — Fix race condition: concurrent requests mutate shared `package.json`](https://github.com/evans-sam/prebid-bundler/issues/22)

**Status:** Design approved 2026-04-16

**Source:** Split out from [2026-04-15 parallel hardening batch 1](2026-04-15-parallel-hardening-batch1-design.md).

---

## Problem

`buildBundle` in [src/server.ts](../../../src/server.ts) implements the `globalVarName` feature by mutating the shared version directory's `package.json` in place:

1. Read `dist/prebid.js/prebid_X_Y_Z/package.json`, capture original `globalVarName`.
2. Write back with caller's `globalVarName`.
3. `spawn("npx gulp build", { cwd: versionDir })` — gulp's `require('./package.json')` reads the mutated file.
4. Restore original `globalVarName` in a `finally` block.

If two `/bundle/10.20.0` requests arrive concurrently with different `globalVarName`s, the write/read/restore sequence interleaves unpredictably:

- Request A writes `varA`, spawns gulp.
- Request B writes `varB` before A's gulp has read `package.json` → A's bundle is built with `varB`.
- A's `finally` restores "original" which B captured as `varA` → pkg.json left in a corrupted state.

The shared mutation window is also incorrect for builds **without** `globalVarName`: a concurrent request that omits `globalVarName` still triggers `gulp bundle`, which reads `package.json` and picks up whatever transient value a concurrent mutator wrote.

## Rejected alternatives

### Option (c) from issue: pass `globalVarName` via gulp CLI arg

Infeasible. Prebid's gulpfile loads the value via `var prebid = require('./package.json');` at require time. No environment variable support, no CLI flag, no programmatic override. Adding it would require an upstream Prebid fork.

### Option (b) from issue: copy the version directory per build

Prebid.js checkouts are hundreds of MB (source + `node_modules`). Per-request disk copy is too expensive in both time and space.

### Clever alternatives considered and rejected

- **Per-build gulpfile wrapper that poisons `require.cache`.** Works in theory (`require.cache[pkgPath] = { exports: customPkg }` before requiring Prebid's gulpfile). Fragile dependency on Node internals and Prebid's loading pattern; invisible breakage when Prebid restructures.
- **Symlink overlay + `node --preserve-symlinks`.** Create a per-build dir where every file symlinks to the real version dir except `package.json`. Needs the flag to propagate to gulp's child processes (babel workers, etc). Fragile across gulp internals; untested ground.
- **Linux overlayfs / bind mount.** Linux-only; unusable on macOS dev or non-privileged Docker.

## Chosen solution: per-version async mutex (Option a)

Serialize the entire `package.json`-mutation + gulp-run window per version. Cross-version builds stay parallel. Minimal code change, no dependency on Prebid internals.

### Scope

The mutex wraps this critical section inside `buildBundle`:

```text
acquire(version)
  if globalVarName: setGlobalVarName(versionDir, name)  // pkg.json write
  spawn gulp, await exit or timeout
  finally: if globalVarName: restoreGlobalVarName(versionDir, original)
release(version)
```

Everything outside — UUID generation, `buildDir` creation, output file discovery, file streaming, cleanup — stays unlocked.

Every build of a version acquires the lock, **regardless of whether `globalVarName` was provided on that specific request**. Rationale: a non-mutating build still has gulp read `package.json` at process start. If a mutating build is mid-flight, the non-mutating build's gulp would observe the transient value. Correctness requires locking all builds of the version.

### Lock primitive

New module `src/versionLock.ts` — small, standalone, unit-testable in isolation:

```ts
const tails = new Map<string, Promise<void>>();

export async function withVersionLock<T>(
  version: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = tails.get(version) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const myTail = prev.then(() => mine);
  tails.set(version, myTail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(version) === myTail) tails.delete(version);
  }
}

// Test-only helper; resets internal state between tests.
export function _resetLocksForTest(): void {
  tails.clear();
}
```

Properties:

- **FIFO.** New acquirers await the current tail promise; the chain is linear.
- **Always releases.** `release()` is in `finally`. Rejections, sync throws, timeouts all release.
- **Bounded memory.** Map entry dropped when the tail holder sees no one chained behind it (identity check on `myTail`).
- **Leaf-level.** No nested acquisition, no external async resource while holding. Deadlock-free.

### Integration with `buildBundle`

Wrap the existing pkg.json → spawn → restore window. Keep timing marks, timeout race, and the existing `finally` semantics; just move them inside the lock callback:

```ts
const { exitCode, proc } = await withVersionLock(version, async () => {
  let originalGlobalVarName: string | undefined;
  if (globalVarName) {
    originalGlobalVarName = await setGlobalVarName(versionDir, globalVarName);
  }
  try {
    mark(ctx, "gulp:start");
    const gulpCommand = globalVarName ? "build" : "bundle";
    const proc = spawn(
      ["npx", "gulp", gulpCommand, `--modules=${modulesArg}`],
      { cwd: versionDir, stdout: "pipe", stderr: "pipe",
        env: { ...process.env, PREBID_DIST_PATH: buildDir } },
    );
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => { proc.kill();
        reject(new Error(`Build timed out after ${config.buildTimeoutMs}ms`));
      }, config.buildTimeoutMs);
    });
    const exitCode = await Promise.race([proc.exited, timeoutPromise]);
    mark(ctx, "gulp:end");
    return { exitCode, proc };
  } finally {
    if (originalGlobalVarName !== undefined) {
      await restoreGlobalVarName(versionDir, originalGlobalVarName);
    }
  }
});
```

Post-lock handling (stderr read on non-zero exit, output file discovery, cleanup on error) stays in the outer scope of `buildBundle` — unchanged.

The route handler in `createServer` is not touched.

## Error handling

| Scenario | Behavior |
|---|---|
| gulp exits non-zero | `finally` restores pkg.json → lock releases → outer code reads stderr, cleans buildDir, throws. |
| gulp timeout | `timeoutPromise` rejects → `finally` restores pkg.json → lock releases → outer code cleans buildDir, throws. |
| `setGlobalVarName` throws (FS error) | `finally` runs but `originalGlobalVarName === undefined`, so restore is skipped. Lock releases. No mutation happened → no corruption. |
| `restoreGlobalVarName` throws | Lock still releases (finally runs release before `restoreGlobalVarName` throws through). Pkg.json left mutated — same as today. Logged by caller. |
| Node process killed mid-lock | In-memory lock dies with the process. Pkg.json may be left mutated — known limitation, same as today. Out of scope. |

## Edge cases

- **Different versions concurrent.** Each version has its own map entry. No cross-version blocking.
- **No `globalVarName` on request.** Lock still acquired. `setGlobalVarName`/`restoreGlobalVarName` both skipped. Overhead is one promise await — negligible.
- **Heavy same-version load.** Requests queue FIFO. Each gulp build is CPU-bound anyway — serialization is not a meaningful throughput loss on a single-process server.
- **Multiple server replicas sharing one prebid dir.** The mutex is per-process; replicas would still race. Out of scope; not a current deployment target.

## Known pre-existing bug (out of scope)

`restoreGlobalVarName` is guarded by `originalGlobalVarName !== undefined`. If the base `package.json` had no `globalVarName` field, `setGlobalVarName` returns `undefined`, the restore is skipped, and the injected value persists. This is a separate correctness bug; flagged here for visibility but **not fixed in this spec**. A follow-up issue should track it.

## Acceptance criteria mapping

From issue #22:

- [x] **"No code path mutates the shared version directory's `package.json` per request, OR access is serialized."** → Access serialized via per-version mutex.
- [x] **"Test fires two concurrent requests with different `globalVarName`s and verifies each gets the right output."** → Test #7 below.
- [x] **"Restore-on-failure path remains correct."** → Test #8 below; `finally` inside locked section preserved.

## Test plan

### `src/versionLock.test.ts` (new file, primitive-level)

1. **Sequential execution per version.** Two `withVersionLock("v1", fn)` calls with a 50 ms delay. Record start timestamps. Assert second starts after first ends.
2. **Cross-version parallelism.** `withVersionLock("v1", …)` and `withVersionLock("v2", …)` concurrent. Assert overlap (start deltas within a few ms).
3. **Release on rejection.** `fn` rejects. Assert next acquirer of same version still runs.
4. **Release on synchronous throw.** `fn` throws sync. Assert next acquirer still runs.
5. **FIFO ordering.** Queue five acquirers. Assert completion order matches acquisition order.
6. **Map cleanup.** After last release, map has no entry for that version.

`_resetLocksForTest()` called in `afterEach`.

### `src/server.test.ts` (additions, integration with `buildBundle`)

7. **Concurrent same-version different `globalVarName` (primary acceptance test).**
   - Mock `spawn` with ~100 ms delay; during the delay, read the version dir's `package.json` and record the current `globalVarName`.
   - Fire two `buildBundle` calls concurrently on `10.20.0`, one with `globalVarName: "varA"`, one with `"varB"`.
   - Assert: captured value for call A is `"varA"`, captured value for call B is `"varB"`.
   - Assert: final pkg.json on disk equals the pre-test baseline.

8. **Concurrent same-version, timeout then success (restore-on-failure).**
   - Build 1: mock `spawn` that never exits → triggers `BUILD_TIMEOUT_MS`.
   - Build 2: queued behind, mock `spawn` succeeds.
   - Assert: Build 1 rejects with timeout error.
   - Assert: pkg.json restored to baseline after Build 1's rejection.
   - Assert: Build 2's captured `globalVarName` is its own value, and its spawn only starts after Build 1 fully rejects.

9. **Concurrent different versions — no serialization.**
   - Fixtures for `10.20.0` and `10.19.0`. Concurrent `buildBundle` calls, mock spawn ~100 ms.
   - Assert: total wall time is close to 100 ms, not ~200 ms. (Slack to absorb CI jitter; e.g. `< 180 ms`.)

10. **Same-version build without `globalVarName` waits behind a mutating build.**
    - Build 1: with `globalVarName`, slow mock spawn.
    - Build 2: no `globalVarName`, fast mock spawn, queued concurrently.
    - Assert: Build 2's spawn starts only after Build 1's pkg.json is restored.

### Execution

```bash
bun test src/versionLock.test.ts
bun test src/server.test.ts
```

All existing tests in `src/server.test.ts` must continue to pass unchanged.

## Files touched

- **New:** `src/versionLock.ts` (~25 lines plus test helper).
- **New:** `src/versionLock.test.ts`.
- **Modified:** `src/server.ts` — wrap the pkg.json/spawn/restore window in `buildBundle` with `withVersionLock`. Import added. No route handler changes.
- **Modified:** `src/server.test.ts` — add tests 7–10.

## Out of scope

- The pre-existing restore bug for pkg.json that originally had no `globalVarName` field (separate issue).
- Multi-process lock coordination (single-process deployment today).
- Replacing the pkg.json mutation approach with a cleaner mechanism (upstream Prebid change needed).
