import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { clearTimings, createTimingContext, mark, measure } from "./perf.ts";
import { parseVersion } from "./utils.ts";
import { withVersionLock } from "./versionLock.ts";
import { file } from "bun";

// ---------------------------------------------------------------------------
// Input validation (issues #20, #21)
//
// Both values flow into shell-adjacent or file contents (gulp --modules=...
// and a version's package.json respectively), so we enforce a strict
// allowlist at the HTTP boundary. Rejected values are NOT echoed in error
// responses to avoid log-injection via the API surface.
// ---------------------------------------------------------------------------

// Module names: allow letters, digits, dot, underscore, dash — but the first
// character must be a letter, digit, or underscore. This prevents flag-like
// tokens ("--", "-abc") from being passed through to argv consumers, and
// rejects pure path-traversal tokens ("..", "../x"). Slashes, whitespace,
// shell metacharacters, and control characters are all outside the allowlist.
const MODULE_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;

// globalVarName: a JavaScript identifier (excluding reserved words). Must
// start with a letter, underscore, or $.
const GLOBAL_VAR_NAME_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

// JS reserved words cannot be used as identifiers in strict mode or as
// globally-assigned variable names without breaking the generated bundle.
// Keep this list minimal but complete enough to catch the common words.
const JS_RESERVED_WORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "await",
  "async",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "static",
]);

const MODULE_NAME_MAX = 128;
const GLOBAL_VAR_NAME_MAX = 64;

export function validateModuleName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= MODULE_NAME_MAX && MODULE_NAME_RE.test(name);
}

export function validateGlobalVarName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= GLOBAL_VAR_NAME_MAX &&
    GLOBAL_VAR_NAME_RE.test(name) &&
    !JS_RESERVED_WORDS.has(name)
  );
}

export interface ServerConfig {
  prebidDir: string;
  buildsDir: string;
  port: number;
  buildTimeoutMs: number;
  /** Optional spawn function for testing */
  spawn?: typeof Bun.spawn;
}

export interface BuildMetrics {
  buildId: string;
  dirSetup: number;
  gulpBuild: number;
  moduleCount: number;
  total: number;
  validation: number;
  version: string;
}

export function logMetrics(metrics: BuildMetrics): void {
  console.log(
    `[build:${metrics.buildId.slice(0, 8)}] ` +
      `v${metrics.version} (${metrics.moduleCount} modules) | ` +
      `validation: ${metrics.validation.toFixed(0)}ms, ` +
      `setup: ${metrics.dirSetup.toFixed(0)}ms, ` +
      `gulp: ${metrics.gulpBuild.toFixed(0)}ms, ` +
      `total: ${metrics.total.toFixed(0)}ms`,
  );
}

export function getVersionDir(prebidDir: string, version: string): string {
  const underscores = version.replaceAll(/\./g, "_");
  return join(prebidDir, `prebid_${underscores}`);
}

export async function cleanupBuildDir(buildDir: string, buildId?: string): Promise<boolean> {
  const id = buildId ? buildId.slice(0, 8) : "unknown";
  try {
    await rm(buildDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return true;
  } catch (error) {
    console.error(`[cleanup:${id}] failed to remove ${buildDir}: ` + `${error instanceof Error ? error.message : error}`);
    return false;
  }
}

export async function getAvailableVersions(prebidDir: string): Promise<string[]> {
  if (!existsSync(prebidDir)) {
    return [];
  }

  const dirs = await readdir(prebidDir);
  return dirs
    .filter((d) => d.startsWith("prebid_"))
    .map((d) => d.replace("prebid_", "").replaceAll("_", "."))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

export async function getModulesForVersion(prebidDir: string, version: string): Promise<string[]> {
  const modulesDir = join(getVersionDir(prebidDir, version), "modules");

  if (!existsSync(modulesDir)) {
    throw new Error(`Version ${version} not found`);
  }

  const entries = await readdir(modulesDir, { withFileTypes: true });
  const modulesSet = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = join(modulesDir, entry.name);
      const hasIndex = (await Bun.file(join(dirPath, "index.js")).exists()) || (await Bun.file(join(dirPath, "index.ts")).exists());
      if (hasIndex) {
        modulesSet.add(entry.name);
      }
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".ts")) {
      modulesSet.add(entry.name.replace(/\.(js|ts)$/, ""));
    }
  }

  return [...modulesSet].sort();
}

export interface BundleRequest {
  modules: string[];
  globalVarName?: string;
}

export async function setGlobalVarName(versionDir: string, globalVarName: string): Promise<string> {
  const packageJsonPath = join(versionDir, "package.json");
  const packageJsonFile = file(packageJsonPath);
  const packageJson = await packageJsonFile.json();
  const originalGlobalVarName = packageJson.globalVarName;
  packageJson.globalVarName = globalVarName;
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
  return originalGlobalVarName;
}

export async function restoreGlobalVarName(versionDir: string, originalGlobalVarName: string): Promise<void> {
  const packageJsonPath = join(versionDir, "package.json");
  const packageJsonFile = file(packageJsonPath);
  const packageJson = await packageJsonFile.json();
  packageJson.globalVarName = originalGlobalVarName;
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
}

export interface BuildResult {
  buildDir: string;
  buildId: string;
  outputFile: string;
}

interface BuildBundleParams {
  config: ServerConfig;
  version: string;
  modules: string[];
  globalVarName?: string;
}

export async function buildBundle({ config, version, modules, globalVarName }: BuildBundleParams): Promise<BuildResult> {
  const buildId = crypto.randomUUID();
  const ctx = createTimingContext(`build:${buildId.slice(0, 8)}`);
  const spawn = config?.spawn || Bun.spawn;

  mark(ctx, "start", { version, moduleCount: modules.length });

  // Phase 1: Validation
  mark(ctx, "validation:start");
  const versionDir = getVersionDir(config.prebidDir, version);
  if (!existsSync(versionDir)) {
    clearTimings(ctx);
    throw new Error(`Version ${version} not found`);
  }
  mark(ctx, "validation:end");

  // Phase 2: Directory setup (unlocked — per-build isolated)
  mark(ctx, "dirSetup:start");
  const buildDir = join(config.buildsDir, buildId);
  await mkdir(buildDir, { recursive: true });
  mark(ctx, "dirSetup:end");

  // Phase 3: Serialized pkg.json mutation + gulp build (per-version mutex).
  // Every build of a version takes the lock, even ones without globalVarName:
  // gulp reads pkg.json at startup, so a concurrent mutating build could
  // otherwise leak its transient value into us.
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

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          proc.kill();
          reject(new Error(`Build timed out after ${config.buildTimeoutMs}ms`));
        }, config.buildTimeoutMs);
      });

      let code: number;
      try {
        code = await Promise.race([proc.exited, timeoutPromise]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
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

  // Find the built file
  let outputFile = join(buildDir, "prebid.js");
  if (!(await Bun.file(outputFile).exists())) {
    const defaultOutput = join(versionDir, "build", "dist", "prebid.js");
    if (await Bun.file(defaultOutput).exists()) {
      outputFile = defaultOutput;
    } else {
      clearTimings(ctx);
      await cleanupBuildDir(buildDir, buildId);
      throw new Error("Build completed but output file not found");
    }
  }

  mark(ctx, "end");

  logMetrics({
    buildId,
    version,
    moduleCount: modules.length,
    validation: measure(ctx, "validation", "validation:start", "validation:end"),
    dirSetup: measure(ctx, "dirSetup", "dirSetup:start", "dirSetup:end"),
    gulpBuild: measure(ctx, "gulp", "gulp:start", "gulp:end"),
    total: measure(ctx, "total", "start", "end"),
  });

  clearTimings(ctx);

  return { outputFile, buildId, buildDir };
}

async function* generateFileStream(filePath: string, buildId: string, cleanupDir?: string): AsyncGenerator<Uint8Array> {
  const ctx = createTimingContext(`stream:${buildId.slice(0, 8)}`);
  const file = Bun.file(filePath);
  let bytesWritten = 0;

  mark(ctx, "start");
  try {
    for await (const chunk of file.stream()) {
      yield chunk;
      bytesWritten += chunk.length;
    }
  } finally {
    mark(ctx, "streamEnd");
    const streamTime = measure(ctx, "stream", "start", "streamEnd");
    console.log(`[stream:${buildId.slice(0, 8)}] ` + `sent ${(bytesWritten / 1024).toFixed(1)}KB in ${streamTime.toFixed(0)}ms`);

    if (cleanupDir) {
      mark(ctx, "cleanupStart");
      const success = await cleanupBuildDir(cleanupDir, buildId);
      mark(ctx, "cleanupEnd");
      if (success) {
        const cleanupTime = measure(ctx, "cleanup", "cleanupStart", "cleanupEnd");
        console.log(`[cleanup:${buildId.slice(0, 8)}] ` + `completed in ${cleanupTime.toFixed(0)}ms`);
      }
    }

    clearTimings(ctx);
  }
}

function streamFileAndCleanup(filePath: string, buildId: string, cleanupDir?: string): Response {
  const file = Bun.file(filePath);

  return new Response(generateFileStream(filePath, buildId, cleanupDir), {
    headers: {
      "Content-Type": "application/javascript",
      "Content-Disposition": `attachment; filename="prebid.js"`,
      "Content-Length": String(file.size),
    },
  });
}

export function createServer(config: ServerConfig) {
  const server = Bun.serve({
    port: config.port,
    routes: {
      "/bundle/:version": {
        POST: async (req) => {
          const requestId = crypto.randomUUID().slice(0, 8);
          const ctx = createTimingContext(`request:${requestId}`);
          mark(ctx, "start");

          const version = parseVersion(req.params.version);
          if (!version) {
            clearTimings(ctx);
            return Response.json({ error: "Invalid version format" }, { status: 400 });
          }

          let body: BundleRequest;
          try {
            body = (await req.json()) as BundleRequest;
          } catch {
            clearTimings(ctx);
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
          }

          if (!Array.isArray(body?.modules) || body?.modules?.length === 0) {
            clearTimings(ctx);
            return Response.json({ error: "modules array is required" }, { status: 400 });
          }

          const modules = [
            ...new Set(body.modules.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim())),
          ];

          if (modules.length === 0) {
            clearTimings(ctx);
            return Response.json({ error: "modules array must contain valid module names" }, { status: 400 });
          }

          // Strict allowlist validation: reject any module name that is not a
          // simple identifier-like token. Prevents shell metacharacters, path
          // traversal, flag-lookalikes, and unicode bidi tricks from reaching
          // `gulp --modules=...`. The 400 response names the field index but
          // never echoes the rejected value (log-injection defense).
          for (let i = 0; i < modules.length; i++) {
            if (!validateModuleName(modules[i])) {
              clearTimings(ctx);
              return Response.json({ error: "Invalid module name", field: `modules[${i}]` }, { status: 400 });
            }
          }

          // globalVarName: `undefined` (omitted) is allowed. Any other value
          // must be a valid JS identifier within the length cap, otherwise
          // reject with 400. Non-strings (number, null, array, ...) land here.
          let globalVarName: string | undefined;
          if (body.globalVarName !== undefined) {
            if (!validateGlobalVarName(body.globalVarName)) {
              clearTimings(ctx);
              return Response.json({ error: "Invalid globalVarName", field: "globalVarName" }, { status: 400 });
            }
            globalVarName = body.globalVarName;
          }

          console.log(
            `[request] POST /bundle/${version} with ${modules.length} modules: ` +
              `${modules.slice(0, 3).join(", ")}${modules.length > 3 ? "..." : ""}` +
              `${globalVarName ? ` (globalVarName: ${globalVarName})` : ""} `,
          );

          try {
            const { outputFile, buildId, buildDir } = await buildBundle({ config, version, modules, globalVarName });

            mark(ctx, "buildComplete");
            const requestTime = measure(ctx, "untilStream", "start", "buildComplete");
            console.log(`[request:${buildId.slice(0, 8)}] ` + `ready to stream after ${requestTime.toFixed(0)}ms`);
            clearTimings(ctx);

            return streamFileAndCleanup(outputFile, buildId, buildDir);
          } catch (error) {
            clearTimings(ctx);
            const message = error instanceof Error ? error.message : "Build failed";
            console.error(`[error] ${message}`);
            return Response.json({ error: message }, { status: 500 });
          }
        },
      },
      "/modules/:version": {
        GET: async (req) => {
          const version = parseVersion(req.params.version);
          if (!version) {
            return Response.json({ error: "Invalid version format" }, { status: 400 });
          }

          try {
            const modules = await getModulesForVersion(config.prebidDir, version);
            return Response.json({ version, modules });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            return Response.json({ error: message }, { status: 404 });
          }
        },
      },
      "/versions": {
        GET: async () => {
          try {
            const versions = await getAvailableVersions(config.prebidDir);
            return Response.json({ versions });
          } catch (error) {
            console.error("[error] Failed to get versions:", error);
            return Response.json({ error: "Failed to retrieve versions" }, { status: 500 });
          }
        },
      },
      "/health": {
        GET: () => Response.json({ status: "ok" }),
      },
    },
    fetch() {
      return Response.json(
        {
          error: "Not found",
          endpoints: [
            "GET /versions - List available Prebid.js versions",
            "GET /modules/:version - List modules for a version",
            "POST /bundle/:version - Build bundle with specified modules",
            "GET /health - Health check",
          ],
        },
        { status: 404 },
      );
    },
    error(error) {
      console.error("[fatal] Unhandled error:", error);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    },
  });

  return server;
}
