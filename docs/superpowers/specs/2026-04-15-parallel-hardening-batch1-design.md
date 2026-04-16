# Parallel hardening batch 1: LICENSE, Dependabot + supply-chain pins, injection validation

**Status:** Approved
**Date:** 2026-04-15
**Scope:** Resolve GitHub issues #29, #2, #8, #11, #20, #21 via three parallel sub-agent PRs.

## Problem

Six open hardening issues split naturally into three independent work streams:

- **#29 (critical)** — `package.json` claims MIT but no `LICENSE` file exists; MIT claim is not legally binding.
- **#2 / #8 / #11 (critical + high)** — No Dependabot config, Docker base image uses floating tag `oven/bun:1`, all GitHub Actions use floating `@v*` tags. Supply-chain risk: compromised or changed upstream artifacts execute in CI with `GITHUB_TOKEN`.
- **#20 / #21 (critical)** — User-supplied `modules[]` and `globalVarName` reach `gulp` / written into `package.json` with only trivial validation. Injection crits.

No file overlap between streams — all three can be implemented and merged independently.

## Goals

- Ship three isolated PRs that close the six issues.
- Each PR stands alone — reviewable, revertable, `closes #<n>` references.
- Security-critical code (#20/#21) ships with tests written first (TDD).

## Non-goals

- `src/commands/init.ts:208` inline Dockerfile is included under Stream B for the digest pin; the broader note in #19 ("Remove stale `dist/cache` references") is NOT included here.
- Other hardening issues (#3, #6, #7, #9, #10, #12, #13, #14, #15, #16, #17, #18, #22–#28, #30–#44) are out of scope for this batch.
- #42 (broader validation test coverage) is partially advanced by Stream C's injection tests but not explicitly closed.

## Architecture

### Orchestration

Main session (this conversation) acts as coordinator. Dispatches three `general-purpose` sub-agents via the `Agent` tool with `isolation: "worktree"`. Each agent gets an auto-created git worktree off `main`.

```
main (origin)
 ├── worktree A → agent A → branch claude/<auto> → PR #nnn (closes #29)
 ├── worktree B → agent B → branch claude/<auto> → PR #nnn (closes #2, #8, #11)
 └── worktree C → agent C → branch claude/<auto> → PR #nnn (closes #20, #21)
```

The coordinator does not touch source files directly — all work flows through sub-agent PRs.

### Agent output contract

Each agent must:
1. Implement the scope for its stream.
2. Run verification locally (see per-stream verification).
3. Commit with a clear message (Conventional Commits).
4. Push the branch to `origin`.
5. Open a PR to `main` with:
   - Title matching the convention below.
   - Body containing acceptance-criteria checklist from the issue(s) + one-line rationale.
   - Uses `closes #<n>` (or `closes #<n>, closes #<m>`) to auto-link/auto-close.
6. Return to the coordinator: worktree path, branch name, PR URL, verification output summary.

### PR title convention

- Stream A: `fix: add LICENSE file (closes #29)`
- Stream B: `chore(security): pin supply chain — dependabot, docker digest, action SHAs (closes #2, #8, #11)`
- Stream C: `fix(security): validate module names and globalVarName at API boundary (closes #20, #21)`

## Per-stream scope

### Stream A — Add LICENSE (#29)

**Files changed:** `LICENSE` (new, repo root).

**Content:** Standard MIT text, copyright line `Copyright (c) 2026 Sam Evans` (agent verifies holder from `git config user.name` / README; adjusts if the canonical attribution differs).

**Verification:**
- `bun run lint` passes.
- No other files changed (`git status` shows only new `LICENSE`).
- Post-merge: GitHub repo sidebar shows "MIT License" (out of scope for the agent; coordinator or reviewer confirms after merge).

### Stream B — Supply-chain pins (#2, #8, #11)

**Files changed:**
- `.github/dependabot.yml` (new)
- `Dockerfile` (modified — `FROM` line)
- `src/commands/init.ts` around line 208 (modified — inline Dockerfile template `FROM` line)
- All `.github/workflows/*.yml` (modified — every `uses: xxx@v*` line)

**Work items:**

1. **`.github/dependabot.yml`** with three ecosystems:
   - `npm` at `/` — weekly (Monday), PR label `dependencies`, group `patch+minor` into one PR, `major` separate, `open-pull-requests-limit: 5`.
   - `github-actions` at `/` — weekly, same grouping/labels.
   - `docker` at `/` — weekly, same grouping/labels. (The inline Dockerfile in `src/commands/init.ts` is NOT a separate Dockerfile path Dependabot can scan; it's a template string. Flag this as a known limitation in the PR body so future maintainers know to bump it manually or migrate to a real Dockerfile template file.)

2. **Docker base image digest** — replace `FROM oven/bun:1` with `FROM oven/bun:1@sha256:<digest>` in:
   - `Dockerfile:15`
   - `src/commands/init.ts:208` (the inline template)
   
   Agent resolves the current digest for `oven/bun:1` using:
   ```bash
   docker buildx imagetools inspect oven/bun:1 --format '{{.Manifest.Digest}}'
   ```
   (Fallback: `docker pull oven/bun:1` then `docker inspect --format='{{index .RepoDigests 0}}' oven/bun:1`.)

3. **GitHub Actions SHA pins** — for every `uses: <owner>/<repo>@v<tag>` line across all workflows, replace with `uses: <owner>/<repo>@<40-char-sha> # v<tag>`. Agent resolves each SHA via:
   ```bash
   gh api repos/<owner>/<repo>/git/refs/tags/v<tag> --jq '.object.sha'
   ```
   Tags of form `vX` (not `vX.Y.Z`) resolve to lightweight tag objects; agent uses `.object.sha` directly. If the tag is annotated, dereference with `gh api repos/<owner>/<repo>/git/tags/<sha> --jq '.object.sha'` to get the commit SHA.

   Actions to pin (current usage across workflows): `actions/checkout`, `docker/login-action`, `docker/build-push-action`, `docker/setup-buildx-action`, `oven-sh/setup-bun`, `actions/attest-build-provenance`, `docker/metadata-action`. (Agent should grep workflows itself rather than trust this list — there may be more.)

**Verification:**
- `yq eval '.' .github/dependabot.yml` (or `python -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"`) — valid YAML.
- `docker pull oven/bun:1@sha256:<digest>` succeeds (sanity-check the digest is reachable).
- `grep -rE '@v[0-9]+' .github/workflows/` returns nothing except in the `# v<tag>` comments.
- `bun run lint` and `bun test` still pass.
- `git status` shows only the expected files changed.

### Stream C — Injection validation (#20, #21) with TDD

**Files changed:**
- `src/server.test.ts` (modified — new tests, written first)
- `src/server.ts` (modified — validation regexes and helpers)

**TDD loop:**

1. **RED — write failing tests in `src/server.test.ts`:**
   
   For `modules[]` validation (per #20):
   - Reject: `--`, `;rm -rf /`, `$(whoami)`, `` `id` ``, `..`, `../etc/passwd`, `foo/bar`, `foo bar` (space), `foo;bar`, `-abc` (leading dash), `abc\x00def` (null byte), `abc\u202Edef` (RTL override / unicode bidi), empty string, `"   "` (whitespace-only), module name >128 chars.
   - Accept: `appnexusBidAdapter`, `rubiconBidAdapter`, `foo-bar_baz.js`, `abc123`, `_private`.
   - Response shape on rejection: HTTP 400, body `{"error": "Invalid module name", "field": "modules[<index>]"}` — do NOT echo the raw rejected value (prevents reflected-log injection).
   
   For `globalVarName` validation (per #21):
   - Reject: `"} ;require('child_process').exec('...')`, `return`, `class`, `function` (JS reserved words — agent picks a small representative set), `2pbjs` (leading digit), `my-var` (dash), `my.var` (dot), `my var` (space), `$bad}` (brace), empty string, non-string (number, null, array), length >64.
   - Accept: `pbjs`, `_myGlobal`, `$prebid`, `PrebidJS_v2`.
   - Response shape on rejection: HTTP 400, body `{"error": "Invalid globalVarName", "field": "globalVarName"}`.
   
   Run `bun test` — confirm new tests fail with the current implementation.

2. **GREEN — add validation in `src/server.ts`:**
   
   ```typescript
   const MODULE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
   const GLOBAL_VAR_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
   const MODULE_NAME_MAX = 128;
   const GLOBAL_VAR_NAME_MAX = 64;
   
   function validateModuleName(name: string): boolean {
     return typeof name === "string"
       && name.length > 0
       && name.length <= MODULE_NAME_MAX
       && MODULE_NAME_RE.test(name);
   }
   
   function validateGlobalVarName(name: unknown): name is string {
     return typeof name === "string"
       && name.length > 0
       && name.length <= GLOBAL_VAR_NAME_MAX
       && GLOBAL_VAR_NAME_RE.test(name);
   }
   ```
   
   Wire into the POST `/bundle/:version` handler (around `src/server.ts:305`):
   - After dedupe/filter: for each module in `modules`, if `!validateModuleName(m)` → 400 with index and `"Invalid module name"` error.
   - After `globalVarName` extraction (around `src/server.ts:314`): if `body.globalVarName` is present (not undefined) and `!validateGlobalVarName(body.globalVarName)` → 400 with `"Invalid globalVarName"`.
   
   Run `bun test` — all tests pass (old + new).

3. **REFACTOR:** Extract the two validators to a small named export (e.g., `src/validation.ts` or keep at top of `server.ts` depending on existing style). Keep HTTP handler readable. Re-run `bun test`.

**Verification:**
- `bun test src/server.test.ts` — all tests pass, including the new injection tests.
- `bun run lint` clean.
- Manual smoke: `curl` with malicious payload returns 400 with expected body shape.
- `git status` shows only `src/server.ts` and `src/server.test.ts` (plus any extracted validation module).

## Error handling & edge cases

- **Stream B — digest resolution failure:** If `docker buildx imagetools inspect` fails (network, auth, typo), the agent MUST stop and report, not commit a fabricated digest.
- **Stream B — SHA resolution failure:** Same — if any `gh api` call fails, agent stops and reports.
- **Stream C — response shape:** Error body must NOT include the raw invalid value (per #20 AC: "without echoing it raw"). Tests assert this explicitly.
- **Stream C — concurrent race with #22:** This design does not resolve the concurrent `package.json` mutation (#22). Validation alone does not eliminate the race. Agents should not attempt to also fix #22; that's a separate stream.

## Testing strategy

- Stream A: no tests needed (docs-only).
- Stream B: YAML lint + `docker pull` sanity + existing test suite must still pass. No new unit tests — the guarantees are structural, not behavioral.
- Stream C: TDD — new tests in `src/server.test.ts`. Aim for ≥10 rejection cases per validator to cover the threat surface in the issue bodies.

## Rollout

1. Coordinator dispatches three sub-agents in parallel (single message, three `Agent` tool uses).
2. Each agent works independently in its worktree, pushes, opens PR.
3. Coordinator collects PR URLs and verification summaries.
4. User reviews PRs on GitHub, merges at own pace. Order doesn't matter — no inter-PR dependency.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Agent fabricates a Docker digest or action SHA instead of resolving live | Spec requires the resolution command in the PR body; reviewer can re-run it. Agents instructed to STOP on lookup failure. |
| TDD tests in Stream C are weak ("just make it pass") | Spec lists concrete rejection inputs; reviewer checks the test file covers them. |
| Two PRs race on the same file | No file overlap by design. Verified above. |
| Copyright attribution wrong in LICENSE | Agent cross-checks git config + README; reviewer confirms on PR. |
| Dependabot floods PRs week 1 | `open-pull-requests-limit: 5` + grouped patch/minor caps blast radius. |
| `oven/bun:1` digest drifts between agent resolution and first Dependabot run | Acceptable — Dependabot will open a PR to bump it. This is the intended mechanism. |

## Deliverable summary

Three PRs on `evans-sam/prebid-bundler`:
1. `fix: add LICENSE file (closes #29)`
2. `chore(security): pin supply chain — dependabot, docker digest, action SHAs (closes #2, #8, #11)`
3. `fix(security): validate module names and globalVarName at API boundary (closes #20, #21)`
