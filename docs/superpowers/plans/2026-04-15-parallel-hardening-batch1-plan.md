# Parallel Hardening Batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GitHub issues #29, #2, #8, #11, #20, #21 via three parallel sub-agent PRs, each in its own git worktree off `origin/main`.

**Architecture:** The coordinator (main session executing this plan) creates three sibling worktrees under `.claude/worktrees/`, then dispatches three `general-purpose` sub-agents in parallel (single message, three `Agent` tool calls). Each agent works in its assigned worktree, runs verification, commits, pushes its branch, and opens a PR targeting `main` with `closes #N` references. The coordinator collects the three PR URLs and reports back to the user. No file overlap between streams.

**Tech Stack:** Bun 1.x, TypeScript, Biome (lint/format), GitHub Actions, Dockerfile, `gh` CLI, `git worktree`.

**Design spec:** [docs/superpowers/specs/2026-04-15-parallel-hardening-batch1-design.md](../specs/2026-04-15-parallel-hardening-batch1-design.md) (commit `a149b5a` on `claude/gracious-varahamihira`).

**Related skills (for the coordinator):**
- `superpowers:using-git-worktrees` — worktree safety and cleanup patterns.
- `superpowers:dispatching-parallel-agents` — multi-agent parallel dispatch.
- `superpowers:verification-before-completion` — verify before claiming done.

---

## File structure (across all three streams)

### Stream A (Worktree A, branch `fix/license`)
- **Create:** `LICENSE` (new file, repo root)

### Stream B (Worktree B, branch `chore/supply-chain-pins`)
- **Create:** `.github/dependabot.yml`
- **Modify:** `Dockerfile` (line 15 — `FROM` statement)
- **Modify:** `src/commands/init.ts` (around line 208 — inline Dockerfile template)
- **Modify:** all files under `.github/workflows/` (every `uses: <action>@v<N>` line)

### Stream C (Worktree C, branch `fix/injection-validation`)
- **Modify:** `src/server.ts` (add regex constants + validators; wire into POST `/bundle/:version` handler)
- **Modify:** `src/server.test.ts` (new test cases written TDD-first)

### Coordinator (this plan's executor)
- **Create:** three worktrees under `.claude/worktrees/`
- **No source file changes in the coordinator's worktree** (the spec commit `a149b5a` is already there)

---

## Task 1: Pre-flight verification

**Files:** none (read-only checks)

- [ ] **Step 1: Verify we're in the expected coordinator worktree**

Run:
```bash
pwd
git rev-parse --abbrev-ref HEAD
git status --short
```

Expected:
- pwd ends in `.claude/worktrees/gracious-varahamihira`
- branch is `claude/gracious-varahamihira`
- status is clean (empty output)

If any of these are wrong, STOP and ask the user what's going on — do not proceed.

- [ ] **Step 2: Verify origin/main is fresh**

Run:
```bash
git fetch origin main
git rev-parse origin/main
```

Record the SHA (expected: `14833d6...` or whatever is current).

- [ ] **Step 3: Verify `gh` CLI is authenticated**

Run:
```bash
gh auth status
```

Expected: "Logged in to github.com" with the correct account. If not authenticated, STOP and have the user run `gh auth login`.

- [ ] **Step 4: Verify no existing worktrees conflict with the names we'll use**

Run:
```bash
git worktree list
```

Check none of these paths already exist:
- `.claude/worktrees/license-29`
- `.claude/worktrees/supply-chain`
- `.claude/worktrees/injection-valid`

Also check none of these branches exist locally or remote:
```bash
git branch -a | grep -E '(fix/license|chore/supply-chain-pins|fix/injection-validation)'
```

Expected: empty output. If any exist, STOP and resolve (either reuse the existing worktree or delete it after user confirmation).

---

## Task 2: Create three worktrees off origin/main

**Files:** worktrees created at `.claude/worktrees/{license-29,supply-chain,injection-valid}`

- [ ] **Step 1: Create Stream A worktree (LICENSE)**

Run:
```bash
git worktree add -b fix/license .claude/worktrees/license-29 origin/main
```

Expected output: `Preparing worktree ... HEAD is now at 14833d6 ...`

- [ ] **Step 2: Create Stream B worktree (supply-chain pins)**

Run:
```bash
git worktree add -b chore/supply-chain-pins .claude/worktrees/supply-chain origin/main
```

- [ ] **Step 3: Create Stream C worktree (injection validation)**

Run:
```bash
git worktree add -b fix/injection-validation .claude/worktrees/injection-valid origin/main
```

- [ ] **Step 4: Verify all three worktrees exist**

Run:
```bash
git worktree list
```

Expected: four entries total (this worktree + the three new ones), each on a distinct branch.

---

## Task 3: Dispatch three sub-agents in parallel

This task MUST be executed as a **single message with three `Agent` tool calls** (one per stream) so they run concurrently. Do NOT split into three separate messages.

Each agent gets:
- `subagent_type: "general-purpose"`
- `description: "<3-5 word task summary>"`
- `prompt: <full prompt below>`
- NO `isolation: "worktree"` (we've created worktrees manually so each agent cd's into its own path)

- [ ] **Step 1: Dispatch all three agents (parallel)**

Send a single message with these three `Agent` tool calls:

#### Agent A — LICENSE (issue #29)

**description:** `Add LICENSE file for issue #29`

**prompt:**

````
You are implementing GitHub issue #29 for the repo evans-sam/prebid-bundler. You are working in an isolated git worktree that has already been created for you.

## Your working directory

```
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/license-29
```

Run this as your very first command. Verify with `pwd` and `git rev-parse --abbrev-ref HEAD` (expected branch: `fix/license`).

## The issue (verbatim from GitHub)

Title: [Critical] Add LICENSE file
Category: OSS Project Hygiene

Problem: `package.json:6` declares `"license": "MIT"` but no `LICENSE` file exists in the repo root. Without the actual license text, the MIT claim is not legally binding and downstream users cannot rely on it.

Acceptance criteria:
- [ ] `LICENSE` file present in repo root with MIT text
- [ ] Copyright line filled in correctly
- [ ] GitHub recognizes the license (shows in repo sidebar)

## Scope

1. Create a `LICENSE` file at the repo root.
2. Use the standard MIT License text. The canonical source is https://opensource.org/license/mit — the short form starting with "Permission is hereby granted, free of charge, to any person obtaining a copy of this software...".
3. Copyright line: `Copyright (c) 2026 Sam Evans` (verify by running `git log -1 --format='%an'` on any recent commit; if it says "Sam Evans", use that).
4. Ensure file ends with a trailing newline.
5. NO other file changes.

## Exact MIT text to use

```
MIT License

Copyright (c) 2026 Sam Evans

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OF THE SOFTWARE.
```

## Verification (run ALL before committing)

```bash
# You should be in the worktree
pwd
# Confirm only LICENSE is new
git status --short
# Expected: ?? LICENSE (and nothing else)

# Confirm the file has correct permissions and content
cat LICENSE | head -3
# Expected: 
# MIT License
#
# Copyright (c) 2026 Sam Evans

# Lint check (must pass)
bun run lint
# Expected: no errors
```

## Commit

```bash
git add LICENSE
git commit -m "fix: add LICENSE file

Adds standard MIT license text matching the \"license\": \"MIT\"
claim in package.json.

Closes #29"
```

## Push and open PR

```bash
git push -u origin fix/license

gh pr create --base main --head fix/license --title "fix: add LICENSE file (closes #29)" --body "$(cat <<'PR_BODY'
## Summary
Adds a standard MIT `LICENSE` file at the repo root so the MIT claim in `package.json` is legally binding and GitHub's license detection picks it up.

## Acceptance criteria (from #29)
- [x] `LICENSE` file present in repo root with MIT text
- [x] Copyright line filled in correctly (`Copyright (c) 2026 Sam Evans`)
- [ ] GitHub recognizes the license (shows in repo sidebar) — verifiable after merge

## Test plan
- [x] `bun run lint` passes
- [x] No other files changed

Closes #29
PR_BODY
)"
```

## Return to coordinator

Report back ONLY:
1. The PR URL (from `gh pr create` output).
2. The commit SHA (from `git rev-parse HEAD`).
3. Any errors or unexpected output.

Do NOT attempt to merge the PR.
Do NOT modify other issues.
Do NOT clean up the worktree — the coordinator handles cleanup.
````

#### Agent B — Supply-chain pins (issues #2, #8, #11)

**description:** `Dependabot + Docker digest + Action SHAs`

**prompt:**

````
You are implementing GitHub issues #2, #8, and #11 for the repo evans-sam/prebid-bundler. These are tightly related supply-chain pins: Dependabot config (#2), Docker base-image digest (#8), and GitHub Actions commit-SHA pins (#11). You are working in an isolated git worktree that has already been created for you.

## Your working directory

```
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/supply-chain
```

Run this as your very first command. Verify with `pwd` and `git rev-parse --abbrev-ref HEAD` (expected branch: `chore/supply-chain-pins`).

## The issues (verbatim from GitHub)

### #2 — Add Dependabot configuration
Problem: No `.github/dependabot.yml` exists. Dependency updates for `bun`/`npm` packages and GitHub Actions are not automated.
Fix: Add `.github/dependabot.yml` with `npm`, `github-actions`, and `docker` ecosystems, weekly schedule, group patch/minor updates.
AC:
- [ ] `.github/dependabot.yml` exists and is valid
- [ ] First Dependabot run produces at least one PR or confirms up-to-date
- [ ] PRs are auto-assigned and labeled

### #8 — Pin Docker base image to a digest
Problem: `Dockerfile:15` uses `FROM oven/bun:1`. The `1` tag is floating.
Fix: Pin to digest: `FROM oven/bun:1@sha256:<digest>`.
AC:
- [ ] `Dockerfile` and the inline Dockerfile in `src/commands/init.ts:208` use `@sha256:` digest pins
- [ ] Dependabot `docker` ecosystem enabled in `.github/dependabot.yml`

### #11 — Pin all GitHub Actions to commit SHAs
Problem: All actions in `.github/workflows/` use floating tags.
Fix: Replace all `@v*` references with `@<commit-sha>` and add a comment with the human-readable version.
AC:
- [ ] All workflows use SHA pins with version comments
- [ ] Dependabot is configured to update them

## Work item 1: Create `.github/dependabot.yml`

Write this file exactly (adjust nothing unless lint requires it):

```yaml
# Dependabot configuration — https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot-yml-file
version: 2
updates:
  # JavaScript / Bun packages (package.json + bun.lock)
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "javascript"
    groups:
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"

  # GitHub Actions used in .github/workflows/
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "ci"
    groups:
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"

  # Docker base image in Dockerfile
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "docker"
    groups:
      minor-and-patch:
        update-types:
          - "minor"
          - "patch"
```

Verify YAML:
```bash
# One of these will be available
python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))" && echo "OK"
# or:
bunx yaml validate .github/dependabot.yml 2>/dev/null || echo "yaml tool not available, trust the syntax"
```

## Work item 2: Docker base image digest pin

Resolve the current digest for `oven/bun:1`:

```bash
# Preferred (no pull needed):
docker buildx imagetools inspect oven/bun:1 --format '{{.Manifest.Digest}}'
# Expected output: sha256:<64 hex chars>

# Fallback if buildx not available:
docker pull oven/bun:1
docker image inspect oven/bun:1 --format '{{index .RepoDigests 0}}' | sed 's/.*@//'
```

If BOTH fail (e.g., network issue or docker not running), STOP and return an error to the coordinator. Do NOT fabricate a digest.

Record the digest (example format: `sha256:abcdef0123...`).

Edit `Dockerfile` line 15:
- Before: `FROM oven/bun:1`
- After: `FROM oven/bun:1@sha256:<digest-you-resolved>`

Edit `src/commands/init.ts` — find the inline Dockerfile template (around line 208; search for `oven/bun:1` to locate it):
- Apply the same pin. The template is a template string, so edit the string content while preserving quote style and interpolation.

Smoke-test the digest is reachable:
```bash
docker pull oven/bun:1@sha256:<digest>
# Expected: successful pull
```

## Work item 3: GitHub Actions SHA pins

Find every `uses:` line in `.github/workflows/`:

```bash
grep -rn '^\s*uses:' .github/workflows/
```

For each `uses: <owner>/<repo>@v<tag>` (e.g., `actions/checkout@v4`), resolve the commit SHA:

```bash
# Lightweight tags (most common):
gh api repos/<owner>/<repo>/git/refs/tags/v<tag> --jq '.object.sha'

# If the tag object is annotated (type=tag, not commit), dereference:
SHA=$(gh api repos/<owner>/<repo>/git/refs/tags/v<tag> --jq '.object.sha')
TYPE=$(gh api repos/<owner>/<repo>/git/refs/tags/v<tag> --jq '.object.type')
if [ "$TYPE" = "tag" ]; then
  gh api repos/<owner>/<repo>/git/tags/$SHA --jq '.object.sha'
fi
```

If ANY `gh api` call fails, STOP and return an error to the coordinator. Do NOT fabricate SHAs.

Replace each occurrence using this format (preserve the resolved tag as a comment):
- Before: `uses: actions/checkout@v4`
- After: `uses: actions/checkout@<40-char-sha> # v4`

Preserve indentation exactly. If a `uses:` line already has `@<sha>`, leave it alone.

Actions that appear in this repo (grep to confirm — there may be more):
- `actions/checkout`
- `actions/attest-build-provenance`
- `docker/login-action`
- `docker/build-push-action`
- `docker/setup-buildx-action`
- `docker/metadata-action`
- `oven-sh/setup-bun`

## Verification (run ALL before committing)

```bash
# 1. No floating @v references remain outside comments
grep -rnE '^\s*uses:.*@v[0-9]+$' .github/workflows/
# Expected: empty output

# 2. Every `uses:` has the format @<sha> # v<tag> (or @<sha>)
grep -rn '^\s*uses:' .github/workflows/
# Eyeball: every line should have a 40-char hex SHA, optionally followed by " # v<tag>"

# 3. Dockerfile digest check
grep -n 'FROM oven/bun' Dockerfile src/commands/init.ts
# Expected: both have @sha256:<digest>

# 4. YAML validity of dependabot.yml (see Work item 1)

# 5. Existing test suite still passes
bun test
# Expected: all tests pass

# 6. Lint passes
bun run lint
# Expected: no errors

# 7. Status shows only expected files
git status --short
# Expected changes ONLY:
#   .github/dependabot.yml (new)
#   .github/workflows/*.yml (modified — one or more)
#   Dockerfile (modified)
#   src/commands/init.ts (modified)
```

## Commit

```bash
git add .github/dependabot.yml .github/workflows/ Dockerfile src/commands/init.ts
git commit -m "chore(security): pin supply chain (dependabot, docker digest, action SHAs)

- Add .github/dependabot.yml with npm, github-actions, and docker
  ecosystems on weekly schedule with grouped minor/patch updates.
- Pin Dockerfile and src/commands/init.ts inline template to
  oven/bun:1@sha256:<digest>.
- Replace every uses: action@v<tag> with @<sha> # v<tag> across all
  workflows.

Closes #2
Closes #8
Closes #11"
```

## Push and open PR

```bash
git push -u origin chore/supply-chain-pins

gh pr create --base main --head chore/supply-chain-pins --title "chore(security): pin supply chain - dependabot, docker digest, action SHAs (closes #2, #8, #11)" --body "$(cat <<'PR_BODY'
## Summary
Pins the three external supply-chain surfaces (npm, GitHub Actions, Docker base image) so unpinned tag drift can't silently execute new code in CI or in built images. Dependabot is configured to maintain these pins going forward.

## Changes
- **`.github/dependabot.yml`** (new): `npm`, `github-actions`, `docker` ecosystems, weekly, grouped minor+patch.
- **`Dockerfile`**: `oven/bun:1` → `oven/bun:1@sha256:<digest>`
- **`src/commands/init.ts`** inline Dockerfile template: same digest pin.
- **`.github/workflows/*.yml`**: every `uses: <action>@v<tag>` → `@<sha> # v<tag>`.

## Known limitation
The inline Dockerfile in `src/commands/init.ts` is a template string, not a real Dockerfile path. Dependabot cannot scan it — the digest will need manual bumps in sync with the real Dockerfile, or a future refactor to make it a real Dockerfile file under `docker/`.

## Acceptance criteria
### #2 (Dependabot)
- [x] `.github/dependabot.yml` exists and is valid
- [ ] First Dependabot run produces at least one PR (verifiable post-merge)
- [x] PRs are auto-assigned labels

### #8 (Docker digest)
- [x] `Dockerfile` and inline Dockerfile in `src/commands/init.ts` use `@sha256:` digest pins
- [x] Dependabot `docker` ecosystem enabled

### #11 (Action SHAs)
- [x] All workflows use SHA pins with `# v<tag>` comments
- [x] Dependabot `github-actions` ecosystem enabled

## Test plan
- [x] `bun test` passes
- [x] `bun run lint` passes
- [x] `grep -rnE 'uses:.*@v[0-9]+$' .github/workflows/` returns nothing
- [x] `docker pull oven/bun:1@sha256:<digest>` succeeds

Closes #2
Closes #8
Closes #11
PR_BODY
)"
```

## Return to coordinator

Report back:
1. The PR URL.
2. The commit SHA.
3. The resolved Docker digest (full `sha256:<hex>`).
4. The list of `<owner>/<repo>@<sha> # v<tag>` mappings you applied.
5. Any errors or unexpected output.

Do NOT attempt to merge.
Do NOT touch other issues.
Do NOT clean up the worktree.
````

#### Agent C — Injection validation (issues #20, #21) via TDD

**description:** `TDD injection validation #20/#21`

**prompt:**

````
You are implementing GitHub issues #20 and #21 for the repo evans-sam/prebid-bundler. These are two injection vulnerabilities: unvalidated module names (#20) and unvalidated `globalVarName` (#21). You MUST use test-driven development (red-green-refactor). You are working in an isolated git worktree that has already been created for you.

## Your working directory

```
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/injection-valid
```

Run this as your very first command. Verify with `pwd` and `git rev-parse --abbrev-ref HEAD` (expected branch: `fix/injection-validation`).

## The issues (verbatim from GitHub)

### #20 — Validate module names against strict allowlist regex
Problem: `src/server.ts:163-165` joins user-supplied module names into `--modules=${modulesArg}` and passes them to `npx gulp bundle`. The current filter (`src/server.ts:305-307`) only checks that each entry is a non-empty trimmed string. Names like `--`, `;rm -rf`, `$(whoami)`, or `..` reach gulp unchecked.
Fix: Validate every module name against `^[a-zA-Z0-9._-]+$`. Reject with 400 if any name fails.
AC:
- [ ] Module names validated against strict regex before reaching `buildBundle`
- [ ] Tests cover: shell metacharacters, path traversal, leading dashes, unicode tricks
- [ ] 400 response includes which module name was rejected (without echoing it raw)

### #21 — Validate `globalVarName` against strict allowlist
Problem: `src/server.ts:96-107` writes user-supplied `globalVarName` directly into the version's `package.json`. A value like `"} ; require('child_process')...` could break out of the JSON string.
Fix: Validate against JS-identifier regex `^[a-zA-Z_$][a-zA-Z0-9_$]*$`, max length ~64.
AC:
- [ ] Validation in place at HTTP boundary
- [ ] Tests cover: JSON injection, JS keywords, length limit, empty string, non-string
- [ ] Documented constraint in API docs

## Orientation — read these files first

```bash
# Read these in order to understand the current HTTP handler and tests
# (use the Read tool with absolute paths)
/Users/evansst/Development/prebid-bundler/.claude/worktrees/injection-valid/src/server.ts
/Users/evansst/Development/prebid-bundler/.claude/worktrees/injection-valid/src/server.test.ts
```

Pay attention to:
- `src/server.ts` ~line 300-320: the POST `/bundle/:version` JSON body parsing, dedupe/filter, and `globalVarName` extraction.
- `src/server.ts` ~line 96-107: `setGlobalVarName` (writes to `package.json`).
- `src/server.ts` ~line 160-175: `buildBundle` where `--modules=${modulesArg}` is constructed.
- `src/server.test.ts`: existing test style and how `mockSpawn` / `createTestConfig` or similar helpers are set up (match that style for your new tests).

## TDD Step 1: RED — Write failing tests FIRST

Before writing ANY production code, add tests to `src/server.test.ts` covering both validators. Follow the existing test file's structure (describe/it, imports, helpers).

### Tests for module-name validation

Add a `describe("POST /bundle/:version module name validation", ...)` (or extend the existing bundle tests) with cases for each of these rejections. Each test posts a body like `{ modules: [<bad-name>] }` and asserts the response is 400 with body `{ error: "Invalid module name", field: "modules[<index>]" }` (the `<index>` is the integer index of the first invalid name in the array).

Reject cases — one test each:
- `"--"` (leading dashes — treated as a flag by argv consumers)
- `";rm -rf /"` (shell metacharacter sequence)
- `"$(whoami)"` (command substitution)
- `"`id`"` (backtick command substitution)
- `".."` (path traversal)
- `"../etc/passwd"` (path traversal with slashes)
- `"foo/bar"` (slash — not a valid module name)
- `"foo bar"` (space)
- `"foo;bar"` (semicolon)
- `"-abc"` (leading dash)
- `"abc\u0000def"` (NUL byte)
- `"abc\u202Edef"` (unicode bidi override — RTL trick)
- `""` (empty string — already rejected by existing filter, but confirm shape)
- `"   "` (whitespace only — already rejected, confirm shape)
- `"a".repeat(129)` (exceeds 128-char max)

Accept cases — one test each (all should return 200 or whatever the existing success path returns with a mocked spawn; modify mock as needed):
- `"appnexusBidAdapter"`
- `"rubiconBidAdapter"`
- `"foo-bar_baz.js"`
- `"abc123"`
- `"_private"`

Mixed case — at least one test:
- `modules: ["appnexusBidAdapter", ";rm -rf /"]` → 400 with `field: "modules[1]"` (the second, bad entry).

### Tests for globalVarName validation

Add a `describe("POST /bundle/:version globalVarName validation", ...)`. Each test posts `{ modules: ["<valid>"], globalVarName: <input> }` and asserts 400 with body `{ error: "Invalid globalVarName", field: "globalVarName" }`.

Reject cases — one test each:
- `"\"}; require('child_process').exec('rm -rf /')"` (JSON-string-breakout)
- `"return"` (JS reserved word — pick at least 2 total from return/class/function/import/export/const/let/var/if/else)
- `"class"` (another reserved word)
- `"2pbjs"` (leading digit)
- `"my-var"` (dash)
- `"my.var"` (dot)
- `"my var"` (space)
- `"$bad}"` (brace)
- `""` (empty string)
- `42` (non-string — number)
- `null` (non-string)
- `["pbjs"]` (non-string — array)
- `"a".repeat(65)` (exceeds 64-char max)

Accept cases — one test each:
- `"pbjs"`
- `"_myGlobal"`
- `"$prebid"`
- `"PrebidJS_v2"`

Also: when `globalVarName` is OMITTED (undefined), the request should behave exactly as today (no new validation triggered). Add one test confirming that.

### Response body must NOT echo the raw rejected value

Add a test that posts `modules: ["$(malicious)"]`, reads the 400 response body as JSON, and asserts that `JSON.stringify(body)` does NOT contain the substring `"$(malicious)"`. This enforces the "without echoing it raw" acceptance criterion.

### Run tests to confirm they FAIL

```bash
bun test src/server.test.ts
```

Expected: the new tests fail (validator does not exist yet). Existing tests still pass.

If they unexpectedly pass, your tests are wrong — fix them before proceeding.

## TDD Step 2: GREEN — Minimal implementation

Add validators in `src/server.ts` (near the top, after imports but before the existing code). Consider extracting to a small named section or a new module `src/validation.ts` if it keeps `server.ts` cleaner — your call based on file size.

```typescript
// Validation constants
const MODULE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const GLOBAL_VAR_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
const MODULE_NAME_MAX = 128;
const GLOBAL_VAR_NAME_MAX = 64;

export function validateModuleName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MODULE_NAME_MAX &&
    MODULE_NAME_RE.test(name)
  );
}

export function validateGlobalVarName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= GLOBAL_VAR_NAME_MAX &&
    GLOBAL_VAR_NAME_RE.test(name)
  );
}
```

Wire into the POST `/bundle/:version` handler:

1. After the existing `modules` dedupe (around `server.ts:305-307`), BEFORE calling `buildBundle`, iterate and validate each:

```typescript
for (let i = 0; i < modules.length; i++) {
  if (!validateModuleName(modules[i])) {
    clearTimings(ctx);
    return Response.json(
      { error: "Invalid module name", field: `modules[${i}]` },
      { status: 400 }
    );
  }
}
```

2. After `globalVarName` extraction (around `server.ts:314-316`), if `body.globalVarName` is present (not undefined) and fails validation, return 400:

```typescript
if (body.globalVarName !== undefined && !validateGlobalVarName(body.globalVarName)) {
  clearTimings(ctx);
  return Response.json(
    { error: "Invalid globalVarName", field: "globalVarName" },
    { status: 400 }
  );
}
```

IMPORTANT: The check must distinguish between `undefined` (omitted → allowed) and any other invalid value (present but bad → reject). The existing code's `typeof body.globalVarName === "string" && body.globalVarName.trim().length > 0` coercion to undefined on non-strings is the wrong behavior here — a non-string `globalVarName` should return 400, not silently drop.

Re-run tests:
```bash
bun test src/server.test.ts
```
Expected: ALL tests pass (new + existing).

If any fail, iterate: read the failure, fix the code (NOT the tests unless a test is genuinely wrong), re-run.

## TDD Step 3: REFACTOR

After tests are green, look at `server.ts` with fresh eyes:
- If the handler block got long, extract a `validateBundleRequest(body): { ok: true, modules, globalVarName } | { ok: false, response }` helper.
- If `server.ts` is now too big (>500 lines), consider extracting validators to `src/validation.ts` and importing.

Re-run tests after any refactor:
```bash
bun test src/server.test.ts
bun run lint
```

All must still pass.

## Final verification

```bash
# Full test suite
bun test
# Expected: all tests pass (new + existing). Count of new tests matches what you wrote.

# Lint
bun run lint
# Expected: no errors

# Format check
bun run format:check
# If this fails, run: bun run format

# Status shows ONLY expected files
git status --short
# Expected: modified src/server.ts, src/server.test.ts (and optionally new src/validation.ts)
```

Manual smoke test (optional but recommended):
```bash
# In one terminal: start server (use a unique port to avoid collision)
PORT=18787 bun run src/server.ts &
SERVER_PID=$!

# Wait a moment for startup, then test malicious payload
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:18787/bundle/10.20.0 \
  -H "Content-Type: application/json" \
  -d '{"modules": ["$(whoami)"]}'
# Expected: 400

curl -s -X POST http://localhost:18787/bundle/10.20.0 \
  -H "Content-Type: application/json" \
  -d '{"modules": ["$(malicious)"]}' | jq
# Expected JSON does NOT contain the string "$(malicious)"

kill $SERVER_PID
```

(If there are no Prebid versions checked out, the server may return a different 400 for "version not found" BEFORE hitting module validation. That's acceptable — the unit tests cover the validation ordering.)

## Commit

```bash
git add src/server.ts src/server.test.ts
# Also add src/validation.ts if you created it
git commit -m "fix(security): validate module names and globalVarName at API boundary

Add strict allowlist validation at the POST /bundle/:version boundary:

- Module names: /^[a-zA-Z0-9._-]+\$/, max 128 chars.
- globalVarName: /^[a-zA-Z_\$][a-zA-Z0-9_\$]*\$/, max 64 chars.

Invalid values return 400 with the field name (never the raw value,
which would enable log-injection). Tests cover shell metacharacters,
path traversal, unicode bidi tricks, JSON-string breakout, JS reserved
words, length limits, and non-string types.

Closes #20
Closes #21"
```

## Push and open PR

```bash
git push -u origin fix/injection-validation

gh pr create --base main --head fix/injection-validation --title "fix(security): validate module names and globalVarName at API boundary (closes #20, #21)" --body "$(cat <<'PR_BODY'
## Summary
Adds strict allowlist validation at the POST `/bundle/:version` HTTP boundary to stop injection through `modules[]` (which was flowing into `gulp --modules=...`) and through `globalVarName` (which was written raw into a version's `package.json`).

## Changes
- **`src/server.ts`**: `MODULE_NAME_RE = /^[a-zA-Z0-9._-]+$/`, `GLOBAL_VAR_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/`, length caps 128 / 64, validation wired into the handler before `buildBundle`.
- **`src/server.test.ts`**: TDD-first tests covering the threat surface.

## Error shape
400 body: `{ error: "Invalid module name" | "Invalid globalVarName", field: "modules[<i>]" | "globalVarName" }`. Never echoes the rejected value (log-injection defense).

## Acceptance criteria

### #20
- [x] Module names validated against strict regex before reaching `buildBundle`
- [x] Tests cover: shell metacharacters, path traversal, leading dashes, unicode tricks
- [x] 400 response includes which field was rejected (without echoing raw)

### #21
- [x] Validation in place at HTTP boundary
- [x] Tests cover: JSON injection, JS keywords, length limit, empty string, non-string
- [ ] Documented constraint in API docs — README update TBD in follow-up (out of scope for this PR)

## Test plan
- [x] `bun test` passes (new + existing)
- [x] `bun run lint` passes
- [x] Manual smoke test: `curl -d '{"modules":["\$(whoami)"]}'` → 400
- [x] Response body for rejected input does NOT contain the raw rejected string

Closes #20
Closes #21
PR_BODY
)"
```

## Return to coordinator

Report back:
1. The PR URL.
2. The commit SHA.
3. Total number of tests added (new test count).
4. Whether you extracted a `src/validation.ts` (yes/no).
5. Any errors or unexpected output.

Do NOT attempt to merge.
Do NOT touch other issues.
Do NOT clean up the worktree.
````

- [ ] **Step 2: Wait for all three agents to complete**

Each agent call is foreground (default) — they run in parallel but you wait for all three before continuing. Collect the three result messages.

If any agent errored or failed to push/open a PR, record the failure and continue — do not abort the remaining work. The coordinator will report partial success clearly.

---

## Task 4: Collect results and verify

**Files:** none (read-only checks against GitHub + git)

- [ ] **Step 1: Verify each PR exists and is targeting main**

For each of the three branches, run:
```bash
gh pr list --head fix/license --json url,state,baseRefName
gh pr list --head chore/supply-chain-pins --json url,state,baseRefName
gh pr list --head fix/injection-validation --json url,state,baseRefName
```

Expected for each: one OPEN PR with `baseRefName: "main"`. Record the URL.

- [ ] **Step 2: Verify issue auto-link**

For each PR URL, fetch and confirm `closes #N` references resolved:
```bash
gh pr view <url> --json body,closingIssuesReferences
```

Expected:
- PR A: `closingIssuesReferences` contains issue 29
- PR B: contains issues 2, 8, 11
- PR C: contains issues 20, 21

If any are missing, the PR body didn't use the right syntax — report to the user but do NOT edit the PR yourself.

- [ ] **Step 3: Sanity-check the diffs**

```bash
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/license-29 && git diff origin/main --stat
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/supply-chain && git diff origin/main --stat
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/injection-valid && git diff origin/main --stat
```

Expected:
- A: 1 file added (`LICENSE`), ~20 insertions
- B: 1+ files changed (`.github/dependabot.yml` new, `Dockerfile` modified, `src/commands/init.ts` modified, `.github/workflows/*.yml` modified)
- C: 2 files modified (`src/server.ts`, `src/server.test.ts`), optionally 1 new (`src/validation.ts`)

If any diff is suspiciously large or touches unexpected files, flag to the user before moving on.

- [ ] **Step 4: Return to the coordinator's worktree**

```bash
cd /Users/evansst/Development/prebid-bundler/.claude/worktrees/gracious-varahamihira
```

---

## Task 5: Report to user

- [ ] **Step 1: Build a summary**

Format:
```
Three PRs opened against main:

1. [fix: add LICENSE file (closes #29)](<URL-A>) — commit <SHA-A>
2. [chore(security): pin supply chain (closes #2, #8, #11)](<URL-B>) — commit <SHA-B>
   Docker digest: sha256:<digest>
3. [fix(security): validate module names and globalVarName (closes #20, #21)](<URL-C>) — commit <SHA-C>
   Added <N> new tests

Worktrees left in place at:
- .claude/worktrees/license-29
- .claude/worktrees/supply-chain
- .claude/worktrees/injection-valid

Let me know when to clean them up (after merging).
```

- [ ] **Step 2: Post the summary and stop**

Do NOT attempt to merge, clean up worktrees, or take further action without user instruction.

---

## Rollback / cleanup procedures

These are NOT part of the plan's happy path. Use if the user asks to abandon the work.

### Abandon one stream (e.g., agent failed, start over)

```bash
git worktree remove --force .claude/worktrees/<stream-dir>
git branch -D <branch-name>
# If the branch was pushed:
git push origin --delete <branch-name>
```

### Clean up after all PRs merged

```bash
git worktree remove .claude/worktrees/license-29
git worktree remove .claude/worktrees/supply-chain
git worktree remove .claude/worktrees/injection-valid
# Local branches are usually auto-pruned when you run: git remote prune origin
```

---

## Failure handling

If Task 3 reports partial success (e.g., Agent B failed but A and C succeeded):
1. Report the successful PRs in Task 5's summary as usual.
2. Explicitly list the failed stream, what the agent reported, and suggest: (a) re-dispatch with the same prompt, or (b) investigate the worktree manually.
3. Do NOT delete the failed agent's worktree — the partial work may be salvageable.

If Task 1 or Task 2 fails (environment issue, worktree name conflict, etc.):
1. Stop immediately. Do NOT dispatch any agents.
2. Report the specific check that failed and wait for user direction.

---

## Self-review checklist (run after writing/editing this plan)

- [x] Every step has concrete commands or code (no "TODO", "TBD", "appropriate error handling").
- [x] Every agent prompt is self-contained (agents won't see this plan or the spec).
- [x] Each agent is told not to touch other issues / other files.
- [x] Each PR body uses `closes #N` for auto-link.
- [x] No file overlap between streams (LICENSE / .github+Dockerfile+init.ts / server.ts+server.test.ts).
- [x] Verification commands are specified per stream.
- [x] Failure modes (digest resolution, SHA resolution, test failure) are called out in the agent prompts.
- [x] Working directory paths in agent prompts are absolute.
- [x] Parallel dispatch is specified as a single message with three Agent calls (not three separate messages).
- [x] Spec reference is included for audit.
