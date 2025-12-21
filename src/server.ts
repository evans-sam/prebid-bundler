import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseVersion } from "./utils.ts";

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
}

export interface BuildResult {
  buildDir: string;
  buildId: string;
  outputFile: string;
}

export async function buildBundle(config: ServerConfig, version: string, modules: string[]): Promise<BuildResult> {
  const totalStart = performance.now();
  const buildId = crypto.randomUUID();
  const spawn = config.spawn || Bun.spawn;

  // Phase 1: Validation
  const validationStart = performance.now();
  const versionDir = getVersionDir(config.prebidDir, version);
  if (!existsSync(versionDir)) {
    throw new Error(`Version ${version} not found`);
  }
  const validationTime = performance.now() - validationStart;

  // Phase 2: Directory setup
  const dirSetupStart = performance.now();
  const buildDir = join(config.buildsDir, buildId);
  await mkdir(buildDir, { recursive: true });
  const dirSetupTime = performance.now() - dirSetupStart;

  // Phase 3: Gulp build with timeout
  const gulpStart = performance.now();
  const modulesArg = modules.join(",");
  const proc = spawn(["npx", "gulp", "bundle", `--modules=${modulesArg}`], {
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

  let exitCode: number;
  try {
    exitCode = await Promise.race([proc.exited, timeoutPromise]);
  } catch (error) {
    await cleanupBuildDir(buildDir, buildId);
    throw error;
  }
  const gulpTime = performance.now() - gulpStart;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
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
      await cleanupBuildDir(buildDir, buildId);
      throw new Error("Build completed but output file not found");
    }
  }

  const totalTime = performance.now() - totalStart;

  logMetrics({
    buildId,
    version,
    moduleCount: modules.length,
    validation: validationTime,
    dirSetup: dirSetupTime,
    gulpBuild: gulpTime,
    total: totalTime,
  });

  return { outputFile, buildId, buildDir };
}

async function* generateFileStream(filePath: string, buildId: string, cleanupDir?: string): AsyncGenerator<Uint8Array> {
  const streamStart = performance.now();
  const file = Bun.file(filePath);
  let bytesWritten = 0;

  try {
    for await (const chunk of file.stream()) {
      yield chunk;
      bytesWritten += chunk.length;
    }
  } finally {
    const streamTime = performance.now() - streamStart;
    console.log(`[stream:${buildId.slice(0, 8)}] ` + `sent ${(bytesWritten / 1024).toFixed(1)}KB in ${streamTime.toFixed(0)}ms`);

    if (cleanupDir) {
      const cleanupStart = performance.now();
      const success = await cleanupBuildDir(cleanupDir, buildId);
      if (success) {
        console.log(`[cleanup:${buildId.slice(0, 8)}] ` + `completed in ${(performance.now() - cleanupStart).toFixed(0)}ms`);
      }
    }
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
          const requestStart = performance.now();
          const version = parseVersion(req.params.version);
          if (!version) {
            return Response.json({ error: "Invalid version format" }, { status: 400 });
          }

          let body: BundleRequest;
          try {
            body = (await req.json()) as BundleRequest;
          } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
          }

          if (!Array.isArray(body?.modules) || body?.modules?.length === 0) {
            return Response.json({ error: "modules array is required" }, { status: 400 });
          }

          const modules = [
            ...new Set(body.modules.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim())),
          ];

          if (modules.length === 0) {
            return Response.json({ error: "modules array must contain valid module names" }, { status: 400 });
          }

          console.log(
            `[request] POST /bundle/${version} with ${modules.length} modules: ` +
              `${modules.slice(0, 3).join(", ")}${modules.length > 3 ? "..." : ""} `,
          );

          try {
            const { outputFile, buildId, buildDir } = await buildBundle(config, version, modules);

            console.log(`[request:${buildId.slice(0, 8)}] ` + `ready to stream after ${(performance.now() - requestStart).toFixed(0)}ms`);

            return streamFileAndCleanup(outputFile, buildId, buildDir);
          } catch (error) {
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
