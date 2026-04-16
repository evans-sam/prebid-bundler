# Prebid Bundler — Hardening Issue Inventory

**Date:** 2026-04-15
**Status:** Draft for review
**Purpose:** Catalog of atomic issues to file in the repo issue tracker, derived from a security/supply-chain/OSS-maturity review of the codebase.

## Context

`prebid-bundler` is a small Bun service that builds custom Prebid.js bundles via an HTTP API. As an open source package, it has gaps in supply-chain hygiene, server input validation, OSS project metadata, and end-to-end test coverage. This document inventories those gaps as atomic issues, each ready to be copy-pasted into a GitHub issue.

**Deployment assumption:** The HTTP server is treated as an untrusted-input surface (validate hard, prevent injection). Auth/rate-limiting are out of scope; safe deployment guidance will live in `SECURITY.md`.

## Severity scale

- **Critical** — actively exploitable, blocks legitimate OSS publication, or could cause data integrity loss
- **High** — real attack surface or supply chain risk; address before broad public adoption
- **Medium** — defense-in-depth, OSS maturity gap, or missing best practice
- **Low** — polish, nice-to-have, low-risk hygiene

## Issue block template

Each issue below uses this format. Copy the whole block (heading included) into a new GitHub issue.

```markdown
### [SEVERITY] Title

**Category:** ...
**Suggested labels:** `security`, `supply-chain`, etc.

**Problem:** Description with file:line references.

**Proposed fix:** Concrete approach.

**Acceptance criteria:**
- [ ] ...
- [ ] ...

**References:** (optional)
```

## Categories

1. [Supply Chain & Dependencies](#1-supply-chain--dependencies) — 7 issues
2. [CI/CD Pipeline Security](#2-cicd-pipeline-security) — 4 issues
3. [Docker & Container Hardening](#3-docker--container-hardening) — 5 issues
4. [Server / Application Security](#4-server--application-security) — 9 issues
5. [OSS Project Hygiene](#5-oss-project-hygiene) — 7 issues
6. [Code Quality & Robustness](#6-code-quality--robustness) — 3 issues
7. [Testing & Verification](#7-testing--verification) — 6 issues

**Total: 41 issues.**

---

## 1. Supply Chain & Dependencies

### [Critical] Add Dependabot configuration

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `supply-chain`, `ci`

**Problem:** No `.github/dependabot.yml` exists. Dependency updates for `bun`/`npm` packages and GitHub Actions are not automated, so vulnerable transitive deps and outdated actions can sit indefinitely.

**Proposed fix:** Add `.github/dependabot.yml` with three ecosystems:
- `npm` (Bun-compatible) for root `package.json`, weekly schedule
- `github-actions` for `.github/workflows/`, weekly schedule
- `docker` for `Dockerfile` and the inline Dockerfile in `src/commands/init.ts`, weekly schedule

Group patch/minor updates to reduce PR noise; major updates separate.

**Acceptance criteria:**
- [ ] `.github/dependabot.yml` exists and is valid (verified via `gh api repos/:owner/:repo/dependabot/alerts` or visible in the Dependabot tab)
- [ ] First Dependabot run produces at least one PR or confirms repo is up-to-date
- [ ] PRs are auto-assigned and labeled

**References:** [Configuring Dependabot version updates](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file)

---

### [High] Add `bun audit` to CI

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `supply-chain`, `ci`

**Problem:** No automated vulnerability scan of installed dependencies. A vulnerable transitive dependency could land in `bun.lock` and be published unnoticed.

**Proposed fix:** Add a CI job that runs `bun audit` (or equivalent vulnerability scan) on every PR and on `main`. Fail the build on `high`/`critical` advisories; warn on `moderate`.

**Acceptance criteria:**
- [ ] New workflow (or step in existing CI) runs `bun audit` on PRs and pushes to main
- [ ] Build fails on `high`/`critical`
- [ ] Documented in CONTRIBUTING.md how to triage findings

---

### [High] Verify Prebid.js source integrity at checkout

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `supply-chain`

**Problem:** [src/commands/checkout.ts:80](src/commands/checkout.ts:80) clones `https://github.com/prebid/Prebid.js.git` over HTTPS and checks out a tag with `git -C ${dirName} checkout ${tag}` ([line 112](src/commands/checkout.ts:112)). Git tags are mutable and can be force-pushed; nothing here verifies the tag points at a known commit SHA or is signed.

**Proposed fix:** Maintain a checked-in mapping of `version → expected commit SHA` (or use Prebid's release commit SHAs from GitHub Releases). After `git checkout <tag>`, verify `git rev-parse HEAD` matches the expected SHA and abort if not. Optionally verify GPG signatures if Prebid.js signs tags.

**Acceptance criteria:**
- [ ] Documented mechanism for pinning each Prebid version to a commit SHA
- [ ] Checkout fails loudly when actual SHA differs from expected
- [ ] Test covers the mismatch path

---

### [High] Use `npm ci` instead of `npm install` for Prebid builds

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `supply-chain`

**Problem:** [src/commands/checkout.ts:123](src/commands/checkout.ts:123) runs `npm install && npx gulp build` inside the cloned Prebid version. `npm install` can mutate the lockfile and pull versions outside the lockfile pins; `npm ci` strictly installs from `package-lock.json`.

**Proposed fix:** Replace `npm install` with `npm ci` in the build step. If `package-lock.json` is missing in some Prebid versions, document the policy (skip those versions or fall back with a warning).

**Acceptance criteria:**
- [ ] `src/commands/checkout.ts` uses `npm ci`
- [ ] Build fails clearly when lockfile is absent or out of sync
- [ ] Existing checkout tests still pass

---

### [High] Pin Docker base image to a digest

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `supply-chain`, `docker`

**Problem:** [Dockerfile:15](Dockerfile:15) uses `FROM oven/bun:1`. The `1` tag is floating; the image content can change without a Dockerfile change, breaking reproducibility and creating a supply-chain pivot point.

**Proposed fix:** Pin to digest: `FROM oven/bun:1@sha256:<digest>`. Update via Dependabot's `docker` ecosystem (configured in the Dependabot issue above).

**Acceptance criteria:**
- [ ] `Dockerfile` and the inline Dockerfile in [src/commands/init.ts:208](src/commands/init.ts:208) use `@sha256:` digest pins
- [ ] Dependabot `docker` ecosystem enabled in `.github/dependabot.yml`
- [ ] Documented update process in CONTRIBUTING.md

---

### [Medium] Add CodeQL/SAST scanning workflow

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `ci`

**Problem:** No static analysis pipeline. CodeQL would catch some classes of injection, dangerous regex, and other security smells that manual review misses.

**Proposed fix:** Add `.github/workflows/codeql.yml` using `github/codeql-action`, configured for JavaScript/TypeScript. Schedule weekly + run on PRs touching `src/`.

**Acceptance criteria:**
- [ ] CodeQL workflow exists and runs on PRs to main
- [ ] Findings appear in repo Security tab
- [ ] Documented baseline (initial findings triaged)

---

### [Medium] Add OSSF Scorecard workflow

**Category:** Supply Chain & Dependencies
**Suggested labels:** `security`, `ci`

**Problem:** No automated scoring of project security posture. Scorecard would flag many of the items in this inventory (action pinning, branch protection, signed releases, etc.) on an ongoing basis.

**Proposed fix:** Add `.github/workflows/scorecard.yml` per the OpenSSF template. Publish badge in README.

**Acceptance criteria:**
- [ ] Workflow runs on schedule + on `main`
- [ ] Badge added to README.md
- [ ] Initial score documented as baseline

**References:** [OpenSSF Scorecard](https://github.com/ossf/scorecard)

---

## 2. CI/CD Pipeline Security

### [High] Pin all GitHub Actions to commit SHAs

**Category:** CI/CD Pipeline Security
**Suggested labels:** `security`, `ci`

**Problem:** All actions in `.github/workflows/` use floating tags: `actions/checkout@v4`, `docker/login-action@v3`, `docker/build-push-action@v6`, `docker/setup-buildx-action@v3`, `oven-sh/setup-bun@v2`, `actions/attest-build-provenance@v2`, `docker/metadata-action@v5`. A compromised tag (or new release with a regression) executes immediately in CI with access to `GITHUB_TOKEN` and any secrets.

**Proposed fix:** Replace all `@v*` references with `@<commit-sha>` and add a comment with the human-readable version, e.g. `actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11 # v4.1.1`. Dependabot's `github-actions` ecosystem (see Dependabot issue) will keep these updated.

**Acceptance criteria:**
- [ ] All workflows use SHA pins with version comments
- [ ] Dependabot is configured to update them
- [ ] Documented in CONTRIBUTING.md

**References:** [Pinning actions to a full-length commit SHA](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-third-party-actions)

---

### [High] Declare least-privilege `permissions:` in all workflows

**Category:** CI/CD Pipeline Security
**Suggested labels:** `security`, `ci`

**Problem:** [.github/workflows/check-new-prebid-releases.yml](.github/workflows/check-new-prebid-releases.yml) does not declare a top-level `permissions:` block. The `GITHUB_TOKEN` defaults to repo-wide read/write in many setups. The `build-new-version` job declares its own permissions but the `check-new-versions` job does not, so it inherits defaults.

**Proposed fix:** Add top-level `permissions: contents: read` to each workflow, then opt jobs into more permissions only where needed (already done correctly in the build job).

**Acceptance criteria:**
- [ ] All three workflows in `.github/workflows/` have a top-level `permissions:` block
- [ ] No job has more permissions than it needs
- [ ] Verified via the workflow run's reported token permissions

---

### [Medium] Move shell-script `${{ }}` interpolations behind env vars

**Category:** CI/CD Pipeline Security
**Suggested labels:** `security`, `ci`

**Problem:** Workflows interpolate `${{ }}` expressions directly into `run:` shell scripts in several places (e.g., [check-new-prebid-releases.yml:60-67](.github/workflows/check-new-prebid-releases.yml:60)). If any interpolated value ever contains shell metacharacters (a future workflow_dispatch input, a tag name with quotes, etc.), this is a script-injection sink. Some places already use the safer `env:` pattern; make it consistent.

**Proposed fix:** Audit every `run:` block, move all `${{ }}` references into the step's `env:` block, and reference them as `"$VAR"` in the script.

**Acceptance criteria:**
- [ ] No `run:` block contains a `${{ }}` expression directly
- [ ] All such values flow through `env:` and are quoted in shell
- [ ] Documented as a contribution guideline

**References:** [Security hardening for GitHub Actions — script injection](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-an-intermediate-environment-variable)

---

### [Medium] Add `concurrency:` controls to release workflows

**Category:** CI/CD Pipeline Security
**Suggested labels:** `ci`

**Problem:** `publish-package.yml` and `publish-prebid-images.yml` have no `concurrency:` group. Two near-simultaneous releases (or a re-trigger of a release event) could race and produce inconsistent published artifacts.

**Proposed fix:** Add `concurrency: { group: <workflow-name>-${{ github.ref }}, cancel-in-progress: false }` to publish workflows. For non-publish workflows, allow `cancel-in-progress: true`.

**Acceptance criteria:**
- [ ] `publish-package.yml` and `publish-prebid-images.yml` have concurrency controls
- [ ] Verified by triggering two runs back-to-back

---

## 3. Docker & Container Hardening

### [High] Drop runtime `npm`/`npx` dependency from the image

**Category:** Docker & Container Hardening
**Suggested labels:** `docker`, `security`, `supply-chain`

**Problem:** [Dockerfile:59](Dockerfile:59) installs `npm` in the release stage so the server can spawn `npx gulp bundle` per request. This means: (a) the image carries `npm` plus its dependencies (~hundreds of MB), (b) every bundle request implicitly trusts whatever `npx` decides to fetch/run, and (c) the published image always has `npm` available for any RCE that lands inside the container.

**Proposed fix:** Build the gulp output once at image build time (the `prebid` stage already runs `npx gulp build`). Remove the `npm` install from the release stage and replace `buildBundle` with a path that consumes pre-built modules instead of re-running gulp per request. If per-request module selection truly requires runtime gulp, document the trade-off explicitly and isolate gulp to a separate sidecar.

**Acceptance criteria:**
- [ ] Release stage does not install `npm` or `git`
- [ ] Image size reduced (measured before/after)
- [ ] Bundle endpoint still works for the documented module sets
- [ ] Documented trade-off if any feature is dropped

---

### [High] Add image vulnerability scan (Trivy or Grype) in CI before push

**Category:** Docker & Container Hardening
**Suggested labels:** `security`, `supply-chain`, `docker`, `ci`

**Problem:** `publish-prebid-images.yml` and `check-new-prebid-releases.yml` build and push images without scanning. Vulnerable base-image packages can be published as part of `:latest`.

**Proposed fix:** Add a Trivy (or Grype) scan step between `build` and `push`. Fail the workflow on `HIGH`/`CRITICAL` findings. Upload SARIF results to the Security tab.

**Acceptance criteria:**
- [ ] Scan step runs on every image build before push
- [ ] Push is blocked on `HIGH`/`CRITICAL` findings
- [ ] SARIF uploaded to Security tab

**References:** [aquasecurity/trivy-action](https://github.com/aquasecurity/trivy-action)

---

### [Medium] Add `HEALTHCHECK` to Dockerfile

**Category:** Docker & Container Hardening
**Suggested labels:** `docker`

**Problem:** [Dockerfile](Dockerfile) has no `HEALTHCHECK` directive. The docker-compose.yml has one, but anyone running `docker run ghcr.io/.../prebid-bundler` directly gets no liveness signal.

**Proposed fix:** Add `HEALTHCHECK CMD wget -qO- http://localhost:8787/health || exit 1` (or use `bun` to avoid shipping `wget`). Sync interval/timeout with what compose declares.

**Acceptance criteria:**
- [ ] `Dockerfile` includes `HEALTHCHECK`
- [ ] `docker inspect <image>` shows the healthcheck
- [ ] Healthcheck succeeds for a healthy container and fails for a stopped server

---

### [Medium] Pin apt packages or document floating policy

**Category:** Docker & Container Hardening
**Suggested labels:** `docker`, `supply-chain`

**Problem:** [Dockerfile:31](Dockerfile:31) and [Dockerfile:59](Dockerfile:59) run `apt-get install -y --no-install-recommends git npm` without version pins. Reproducibility depends on whatever Debian repo state existed at build time.

**Proposed fix:** Either pin specific versions (`git=1:2.x.x-x`, `npm=x.x.x`) or document the deliberate floating-version policy in Dockerfile comments. If the "Drop runtime `npm`/`npx` dependency" issue lands, this becomes much narrower.

**Acceptance criteria:**
- [ ] Either explicit version pins or a comment explaining why floating is acceptable
- [ ] Decision documented in CONTRIBUTING.md

---

### [Low] Remove stale `dist/cache` references in init.ts Dockerfile template

**Category:** Docker & Container Hardening
**Suggested labels:** `docker`, `cleanup`

**Problem:** [src/commands/init.ts:252](src/commands/init.ts:252) generates a Dockerfile that creates `./dist/cache` and assigns ownership, but the server only uses `dist/builds` and `dist/prebid.js`. The cache directory is also referenced in [docker/docker-compose.yml:34](docker/docker-compose.yml:34) and the inline compose template at [src/commands/init.ts:326](src/commands/init.ts:326). It's dead code that confuses readers.

**Proposed fix:** Remove all references to `dist/cache` from the init.ts templates and `docker/docker-compose.yml`.

**Acceptance criteria:**
- [ ] No reference to `dist/cache` remains in the repo
- [ ] `prebid-bundler init` and `init --compose` produce templates without it
- [ ] Existing tests still pass

---

## 4. Server / Application Security

### [Critical] Validate module names against strict allowlist regex

**Category:** Server / Application Security
**Suggested labels:** `security`, `injection`

**Problem:** [src/server.ts:163-165](src/server.ts:163) joins user-supplied module names into `--modules=${modulesArg}` and passes them to `npx gulp bundle`. The current filter ([src/server.ts:305-307](src/server.ts:305)) only checks that each entry is a non-empty trimmed string. Names like `--`, `;rm -rf`, `$(whoami)`, or `..` reach gulp unchecked. Even though `Bun.spawn` uses argv (no shell), `gulp` itself parses these strings and may interpret meta-characters; module names with `.` or `/` could affect path resolution.

**Proposed fix:** Validate every module name against `^[a-zA-Z0-9._-]+$` (or the actual Prebid module-name spec). Reject the request with 400 if any name fails. Add tests covering injection attempts.

**Acceptance criteria:**
- [ ] Module names validated against strict regex before reaching `buildBundle`
- [ ] Tests cover: shell metacharacters, path traversal, leading dashes, unicode tricks
- [ ] 400 response includes which module name was rejected (without echoing it raw)

---

### [Critical] Validate `globalVarName` against strict allowlist

**Category:** Server / Application Security
**Suggested labels:** `security`, `injection`

**Problem:** [src/server.ts:96-107](src/server.ts:96) writes the user-supplied `globalVarName` directly into the version's `package.json` and then runs `npx gulp build` against it. A value like `"} ; require('child_process')...` could break out of the JSON string and the resulting bundle could contain attacker-controlled JS executed in the browser of any consumer of the bundle.

**Proposed fix:** Validate `globalVarName` against a strict JS-identifier regex: `^[a-zA-Z_$][a-zA-Z0-9_$]*$`, max length ~64. Reject otherwise.

**Acceptance criteria:**
- [ ] Validation in place at HTTP boundary
- [ ] Tests cover: JSON injection, JS keywords, length limit, empty string, non-string
- [ ] Documented constraint in API docs

---

### [High] Fix race condition: concurrent requests mutate shared `package.json`

**Category:** Server / Application Security
**Suggested labels:** `security`, `concurrency`, `bug`

**Problem:** [src/server.ts:96-118, 150-153, 191-194](src/server.ts:96) implements `globalVarName` by mutating the version directory's `package.json`, running gulp, then restoring. If two `/bundle/10.20.0` requests with different `globalVarName`s arrive concurrently, the file is rewritten under the running gulp process. Either request can build with the other's `globalVarName`, or the restore step can leave the file in an unexpected state.

**Proposed fix:** Choose one:
- **(a)** Add a per-version mutex in `buildBundle`. Simple, but serializes builds for that version.
- **(b)** Copy the version directory to the build dir before gulp runs and modify `package.json` only inside the copy. Slower, but no shared state.
- **(c)** Pass `globalVarName` via gulp arg (e.g., `--global-var-name=...`) instead of mutating `package.json`, if gulp/Prebid supports it. Best if feasible.

Recommend (c) → fallback (a). Add a concurrent-request test.

**Acceptance criteria:**
- [ ] No code path mutates the shared version directory's `package.json` per request, OR access is serialized
- [ ] Test fires two concurrent requests with different `globalVarName`s and verifies each gets the right output
- [ ] Restore-on-failure path remains correct

---

### [High] Cross-check requested modules against version's available modules

**Category:** Server / Application Security
**Suggested labels:** `security`, `validation`

**Problem:** [src/server.ts:300-312](src/server.ts:300) accepts any module name that passes string validation, then relies on gulp to fail later if the module doesn't exist. This (a) wastes build time on requests that will never succeed, (b) leaks gulp's stderr to the API response (see "Don't leak raw gulp stderr" issue), and (c) becomes a probing oracle for what modules a version provides.

**Proposed fix:** After basic validation, reject requests where any module is not present in the result of `getModulesForVersion(version)`. Cache the per-version module list to avoid repeated directory reads.

**Acceptance criteria:**
- [ ] Request rejected with 400 listing unknown modules (without leaking the full module catalog)
- [ ] Cached per-version module list invalidated when a version is added/removed
- [ ] Tests cover the rejection path

---

### [Medium] Validate that version directory exists before doing per-request work

**Category:** Server / Application Security
**Suggested labels:** `bug`, `validation`

**Problem:** [src/server.ts:286-290](src/server.ts:286) only checks semver shape, not whether the version exists on disk. The existence check is buried inside `buildBundle` ([src/server.ts:142-146](src/server.ts:142)), after some setup work. Failures at that point still create a `BuildMetrics` log entry and the directory check happens after `crypto.randomUUID()` work.

**Proposed fix:** Validate version existence at the HTTP route handler before calling `buildBundle`. Return a clean 404.

**Acceptance criteria:**
- [ ] Route handler returns 404 when version dir missing, before allocating a build id
- [ ] `buildBundle` still defends with its own check
- [ ] Test for the unhappy path

---

### [Medium] Cap maximum modules per request

**Category:** Server / Application Security
**Suggested labels:** `security`, `dos`

**Problem:** [src/server.ts:300-312](src/server.ts:300) accepts an unbounded array of module names. A request with 100k entries forces work in dedup/Set, in argv assembly, and in gulp parsing.

**Proposed fix:** Hard cap (e.g., 200 modules per request). Reject with 400 if exceeded.

**Acceptance criteria:**
- [ ] Cap enforced and documented
- [ ] Test for over-cap rejection

---

### [Medium] Cap request body size

**Category:** Server / Application Security
**Suggested labels:** `security`, `dos`

**Problem:** [src/server.ts:294](src/server.ts:294) calls `req.json()` without size limits. An attacker can send a multi-megabyte body and force the server to parse it.

**Proposed fix:** Read `Content-Length` and reject early if over a configurable limit (default ~64KB — module lists are short). For chunked requests without a length, stream-read with a cumulative byte cap.

**Acceptance criteria:**
- [ ] Body size cap enforced; configurable via env var
- [ ] Returns 413 for over-cap bodies
- [ ] Test covers over-cap rejection

---

### [Medium] Don't leak raw gulp stderr in API error responses

**Category:** Server / Application Security
**Suggested labels:** `security`, `info-disclosure`

**Problem:** [src/server.ts:198-201](src/server.ts:198) returns `Build failed: ${stderr}` directly to the API caller. Gulp stderr can include absolute filesystem paths, environment values, and stack traces.

**Proposed fix:** Log raw stderr server-side (already done via `console.error`); return a generic message + a build id to clients (`{"error": "Build failed", "buildId": "..."}`) so support can correlate to logs.

**Acceptance criteria:**
- [ ] API response no longer contains raw stderr
- [ ] Build id is logged with stderr server-side and returned to client
- [ ] Test covers the response shape

---

### [Medium] Set explicit CORS policy

**Category:** Server / Application Security
**Suggested labels:** `security`, `cors`

**Problem:** No CORS handling at [src/server.ts:276-393](src/server.ts:276). Default Bun behavior is permissive in some configurations. For a service whose intended consumer is build pipelines (not browsers), the safe default is to deny cross-origin requests entirely.

**Proposed fix:** Default to no CORS headers (denies cross-origin browser requests). Allow opt-in via env var `ALLOWED_ORIGINS=` for users who want browser access. Document in SECURITY.md.

**Acceptance criteria:**
- [ ] No CORS headers by default
- [ ] `ALLOWED_ORIGINS` env var supported
- [ ] Documented in SECURITY.md and README.md

---

## 5. OSS Project Hygiene

### [Critical] Add LICENSE file

**Category:** OSS Project Hygiene
**Suggested labels:** `legal`, `oss-hygiene`, `good-first-issue`

**Problem:** [package.json:6](package.json:6) declares `"license": "MIT"` but no `LICENSE` file exists in the repo root. Without the actual license text, the MIT claim is not legally binding and downstream users cannot rely on it.

**Proposed fix:** Add a standard `LICENSE` file with the MIT text and the correct copyright holder/year.

**Acceptance criteria:**
- [ ] `LICENSE` file present in repo root with MIT text
- [ ] Copyright line filled in correctly
- [ ] GitHub recognizes the license (shows in repo sidebar)

---

### [High] Add SECURITY.md

**Category:** OSS Project Hygiene
**Suggested labels:** `security`, `oss-hygiene`

**Problem:** No `SECURITY.md` exists. Security researchers have no documented disclosure path, and there's no statement of supported versions or expected response time.

**Proposed fix:** Add `SECURITY.md` covering: (a) supported versions, (b) reporting channel (private security advisory or email), (c) expected response timeline, (d) safe deployment guidance (per the deployment assumption in this doc), (e) link to GitHub Security Advisories.

**Acceptance criteria:**
- [ ] `SECURITY.md` exists at repo root
- [ ] GitHub recognizes it (shows "Security policy" in Security tab)
- [ ] Disclosure channel is monitored

---

### [Medium] Fix package.json metadata

**Category:** OSS Project Hygiene
**Suggested labels:** `oss-hygiene`, `good-first-issue`

**Problem:** [package.json](package.json) has empty `author` (line 5), empty `repository.url` (line 49), and no `bugs` or `homepage` fields. npm and tooling ecosystems use these; missing values look unprofessional and break some downstream automation.

**Proposed fix:** Set:
- `author`: maintainer name + email or GitHub handle
- `repository`: `{ "type": "git", "url": "git+https://github.com/<owner>/prebid-bundler.git" }`
- `bugs`: `{ "url": "https://github.com/<owner>/prebid-bundler/issues" }`
- `homepage`: `"https://github.com/<owner>/prebid-bundler#readme"`

**Acceptance criteria:**
- [ ] All four fields populated correctly
- [ ] `bun publish --dry-run` shows them in the manifest
- [ ] Links resolve

---

### [Medium] Add CONTRIBUTING.md

**Category:** OSS Project Hygiene
**Suggested labels:** `oss-hygiene`, `documentation`

**Problem:** No `CONTRIBUTING.md`. New contributors have no documented setup, test, or PR-review expectations.

**Proposed fix:** Add `CONTRIBUTING.md` covering: prerequisites, local setup (`bun install`, `bun run dev`), test workflow, lint/format rules, branch/PR conventions, security disclosure pointer to SECURITY.md.

**Acceptance criteria:**
- [ ] `CONTRIBUTING.md` exists
- [ ] Linked from README.md
- [ ] GitHub shows it in the contribute prompt

---

### [Medium] Add CODE_OF_CONDUCT.md

**Category:** OSS Project Hygiene
**Suggested labels:** `oss-hygiene`, `community`

**Problem:** No `CODE_OF_CONDUCT.md`. Many OSS adopters and corporate downstream users require one before depending on a project.

**Proposed fix:** Add Contributor Covenant 2.1 (or similar) with a real reporting contact.

**Acceptance criteria:**
- [ ] `CODE_OF_CONDUCT.md` exists
- [ ] Reporting contact specified
- [ ] GitHub recognizes it

---

### [Low] Add issue and PR templates

**Category:** OSS Project Hygiene
**Suggested labels:** `oss-hygiene`, `good-first-issue`

**Problem:** No `.github/ISSUE_TEMPLATE/` or `.github/PULL_REQUEST_TEMPLATE.md`. Issues and PRs arrive without consistent context.

**Proposed fix:** Add templates for: bug report, feature request, security report (pointer to SECURITY.md), and a PR template with a checklist (tests added, docs updated, lint passes).

**Acceptance criteria:**
- [ ] `.github/ISSUE_TEMPLATE/` contains at least bug + feature templates
- [ ] `.github/PULL_REQUEST_TEMPLATE.md` exists
- [ ] New issues/PRs use the templates

---

### [Low] Add CODEOWNERS

**Category:** OSS Project Hygiene
**Suggested labels:** `oss-hygiene`

**Problem:** No `.github/CODEOWNERS`. PR review assignment is manual.

**Proposed fix:** Add `.github/CODEOWNERS` with `* @<maintainer>` and any per-area owners.

**Acceptance criteria:**
- [ ] CODEOWNERS file present
- [ ] PRs auto-request review from owners
- [ ] Verified by opening a test PR

---

## 6. Code Quality & Robustness

### [Medium] Handle SIGTERM/SIGINT gracefully — flush in-flight builds, clean orphan dirs

**Category:** Code Quality & Robustness
**Suggested labels:** `bug`, `reliability`

**Problem:** No signal handlers in [src/index.ts](src/index.ts) or [src/server.ts](src/server.ts). When the server is killed mid-build, gulp child processes are orphaned and `dist/builds/<uuid>/` directories leak indefinitely.

**Proposed fix:** Register SIGTERM/SIGINT handlers that: (a) stop accepting new requests, (b) wait up to N seconds for in-flight builds to finish, (c) kill remaining gulp processes, (d) clean their build dirs, (e) `server.stop()` and exit.

**Acceptance criteria:**
- [ ] SIGTERM and SIGINT trigger graceful shutdown
- [ ] Orphan build dirs cleaned on exit
- [ ] Configurable shutdown deadline (env var)

---

### [Medium] Periodic / startup cleanup of stale build directories

**Category:** Code Quality & Robustness
**Suggested labels:** `bug`, `reliability`

**Problem:** If a stream is interrupted between `buildBundle` returning and `streamFileAndCleanup` finishing ([src/server.ts:234-262](src/server.ts:234)), the build dir leaks. There's no janitor.

**Proposed fix:** On startup, scan `buildsDir` and remove any directory older than N hours. Optionally repeat on a timer.

**Acceptance criteria:**
- [ ] Startup cleanup of dirs older than configurable threshold
- [ ] Test creates a stale dir and verifies cleanup
- [ ] Documented in README

---

### [Low] Replace `coerce()` with strict semver validation

**Category:** Code Quality & Robustness
**Suggested labels:** `bug`, `validation`

**Problem:** [src/utils.ts:7](src/utils.ts:7) uses `valid(coerce(version))`, which is permissive: `coerce("foo.bar.baz-1.2.3")` returns `"1.2.3"`. The HTTP API accepts version-like strings that don't match what's actually on disk.

**Proposed fix:** Replace with strict `valid(version)` (no `coerce`). If partial version forms (`10.20`) need to keep working, document and test the supported forms explicitly.

**Acceptance criteria:**
- [ ] Strict validation in `parseVersion`
- [ ] Tests for edge cases (`10.20`, `10`, `v10.20.0`, garbage)
- [ ] API docs updated

---

## 7. Testing & Verification

### [High] Add real end-to-end test against a pinned Prebid.js version

**Category:** Testing & Verification
**Suggested labels:** `testing`, `ci`

**Problem:** The current test suite never exercises the real chain. [src/server.test.ts:372-695](src/server.test.ts:372) uses a `mockSpawn` that fakes the gulp process. [src/commands/checkout.test.ts:4](src/commands/checkout.test.ts:4) explicitly says *"Integration tests that run git clone are in a separate file"* — but no such file exists. The actual `git clone → npm ci → gulp bundle` chain is never verified in CI.

**Proposed fix:** Add a slow e2e test (gated behind a separate CI job, possibly nightly):
- Real `bun checkout.ts --version <small-pinned-version>` (use the smallest fast-building Prebid release)
- Start the server pointing at the resulting `dist/prebid.js`
- POST `/bundle/<version>` with a known module set
- Assert: 200 response, response is valid JS, contains markers for each requested module

Cache the checkout artifact in CI to keep total time tolerable.

**Acceptance criteria:**
- [ ] e2e test file exists and runs locally
- [ ] CI job runs it on a schedule (nightly) and on tag releases
- [ ] Test catches a deliberate regression (e.g., breaking module-name validation)

---

### [Medium] Add Docker image smoke test in CI

**Category:** Testing & Verification
**Suggested labels:** `testing`, `ci`, `docker`

**Problem:** Docker image build is verified by "did `docker build` exit 0", not "does the image actually serve correct bundles". Dockerfile regressions (missing files, wrong WORKDIR, broken entrypoint) ship without detection.

**Proposed fix:** After `docker build` in `publish-prebid-images.yml` and `check-new-prebid-releases.yml`, add a step that:
- `docker run -d --rm -p 8787:8787 <image>`
- Waits for `/health` to return 200
- Hits `/versions` and asserts the built version is listed
- Hits `/bundle/<version>` with a small module set, asserts non-empty JS body
- Tears down

Run this *before* `push: true` so a broken image never reaches the registry.

**Acceptance criteria:**
- [ ] Smoke-test step runs in both image-publishing workflows before push
- [ ] Workflow fails if smoke test fails
- [ ] Documented in CONTRIBUTING.md

---

### [Medium] Raise test coverage threshold from 50% → 80%

**Category:** Testing & Verification
**Suggested labels:** `testing`

**Problem:** [bunfig.toml:6](bunfig.toml:6) sets `coverageThreshold = 0.5`. 50% allows large untested regions to ship unnoticed.

**Proposed fix:** Raise to `0.8`. If currently failing, add tests in the same PR until it passes — don't lower the bar.

**Acceptance criteria:**
- [ ] `bunfig.toml` threshold = 0.8
- [ ] CI fails when coverage drops below
- [ ] Existing coverage gaps closed

---

### [Medium] Add tests for module-name and globalVarName validation

**Category:** Testing & Verification
**Suggested labels:** `testing`, `security`

**Problem:** Once the module-name and `globalVarName` validation issues land, they need tests covering every injection vector. Without these, the validation can silently regress.

**Proposed fix:** Add tests under [src/server.test.ts](src/server.test.ts) covering for both fields:
- Shell metacharacters (`;`, `|`, `&`, backticks, `$()`)
- Path traversal (`../`, absolute paths)
- Leading dashes (looks like a CLI flag)
- Unicode lookalikes
- Empty / whitespace
- Length limit
- JSON-injection attempts (for globalVarName specifically)

**Acceptance criteria:**
- [ ] Test coverage for at least 10 distinct injection vectors per field
- [ ] Tests fail when validation is removed
- [ ] Listed as required in CONTRIBUTING.md

---

### [Medium] Add concurrent-request test for globalVarName race

**Category:** Testing & Verification
**Suggested labels:** `testing`, `concurrency`

**Problem:** Once the `globalVarName` race-condition fix lands, it needs a test that fires concurrent requests with different `globalVarName`s and asserts each gets the right output. Without this, future refactors could re-introduce the race.

**Proposed fix:** Add a test that uses a `mockSpawn` with deliberate delays, fires 5+ concurrent `/bundle` requests with distinct `globalVarName`s, and asserts:
- Each response's bundle reflects the right `globalVarName`
- The version directory's `package.json` is unchanged at the end (or only ever holds the temporarily-written value during exactly one in-flight build)

**Acceptance criteria:**
- [ ] Test exists in `src/server.test.ts`
- [ ] Fails before the race-condition fix lands; passes after
- [ ] Runs in under 5 seconds (uses mocked spawn delays, not real gulp)

---

### [Low] Resolve the orphan integration-tests comment in checkout.test.ts

**Category:** Testing & Verification
**Suggested labels:** `cleanup`, `documentation`

**Problem:** [src/commands/checkout.test.ts:4](src/commands/checkout.test.ts:4) says *"Integration tests that run git clone are in a separate file."* No such file exists.

**Proposed fix:** Either delete the comment, or write the file (likely subsumed by the e2e test issue above — the real e2e test exercises checkout for real). If subsumed, just delete the comment and link to the e2e file.

**Acceptance criteria:**
- [ ] Comment removed or updated to reference the actual integration/e2e file
- [ ] No misleading documentation about non-existent tests
