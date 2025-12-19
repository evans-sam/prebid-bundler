import {parseVersion} from "./utils.ts";
import {join} from "node:path";
import {readdir, stat, rm, mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";

const ROOT_DIR = join(import.meta.dir, "..");
const PREBID_DIR = join(ROOT_DIR, "dist", "prebid.js");
const BUILDS_DIR = join(ROOT_DIR, "dist", "builds");
const PORT = parseInt(process.env.PORT || "8787");

interface BuildMetrics {
    buildId: string;
    version: string;
    moduleCount: number;
    validation: number;
    dirSetup: number;
    gulpBuild: number;
    total: number;
}

function logMetrics(metrics: BuildMetrics): void {
    console.log(
        `[build:${metrics.buildId.slice(0, 8)}] ` +
        `v${metrics.version} (${metrics.moduleCount} modules) | ` +
        `validation: ${metrics.validation.toFixed(0)}ms, ` +
        `setup: ${metrics.dirSetup.toFixed(0)}ms, ` +
        `gulp: ${metrics.gulpBuild.toFixed(0)}ms, ` +
        `total: ${metrics.total.toFixed(0)}ms`
    );
}

function getVersionDir(version: string): string {
    const underscores = version.replaceAll(/\./g, "_");
    return join(PREBID_DIR, `prebid_${underscores}`);
}

async function getAvailableVersions(): Promise<string[]> {
    if (!existsSync(PREBID_DIR)) {
        return [];
    }

    const dirs = await readdir(PREBID_DIR);
    return dirs
        .filter((d) => d.startsWith("prebid_"))
        .map((d) => d.replace("prebid_", "").replaceAll("_", "."))
        .sort((a, b) => b.localeCompare(a, undefined, {numeric: true}));
}

async function getModulesForVersion(version: string): Promise<string[]> {
    const modulesDir = join(getVersionDir(version), "modules");

    if (!existsSync(modulesDir)) {
        throw new Error(`Version ${version} not found`);
    }

    const files = await readdir(modulesDir);
    const modulesSet = new Set<string>();

    for (const file of files) {
        const filePath = join(modulesDir, file);
        const fileStat = await stat(filePath);

        if (fileStat.isDirectory()) {
            if (existsSync(join(filePath, "index.js")) || existsSync(join(filePath, "index.ts"))) {
                modulesSet.add(file);
            }
        } else if (file.endsWith(".js") || file.endsWith(".ts")) {
            modulesSet.add(file.replace(/\.(js|ts)$/, ""));
        }
    }

    return [...modulesSet].sort();
}

interface BundleRequest {
    modules: string[];
}

interface BuildResult {
    outputFile: string;
    buildId: string;
    buildDir: string;
}

async function buildBundle(version: string, modules: string[]): Promise<BuildResult> {
    const totalStart = performance.now();
    const buildId = crypto.randomUUID();

    // Phase 1: Validation
    const validationStart = performance.now();
    const versionDir = getVersionDir(version);
    if (!existsSync(versionDir)) {
        throw new Error(`Version ${version} not found`);
    }

    const availableModules = await getModulesForVersion(version);
    const invalidModules = modules.filter((m) => !availableModules.includes(m));
    if (invalidModules.length > 0) {
        throw new Error(`Invalid modules: ${invalidModules.join(", ")}`);
    }
    const validationTime = performance.now() - validationStart;

    // Phase 2: Directory setup
    const dirSetupStart = performance.now();
    const buildDir = join(BUILDS_DIR, buildId);
    await mkdir(buildDir, {recursive: true});
    const dirSetupTime = performance.now() - dirSetupStart;

    // Phase 3: Gulp build
    const gulpStart = performance.now();
    const modulesArg = modules.join(",");
    const proc = Bun.spawn(["npx", "gulp", "bundle", `--modules=${modulesArg}`], {
        cwd: versionDir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
            ...process.env,
            PREBID_DIST_PATH: buildDir,
        },
    });

    const exitCode = await proc.exited;
    const gulpTime = performance.now() - gulpStart;

    if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        await rm(buildDir, {recursive: true, force: true});
        throw new Error(`Build failed: ${stderr}`);
    }

    // Find the built file
    let outputFile = join(buildDir, "prebid.js");
    if (!existsSync(outputFile)) {
        const defaultOutput = join(versionDir, "build", "dist", "prebid.js");
        if (existsSync(defaultOutput)) {
            outputFile = defaultOutput;
        } else {
            await rm(buildDir, {recursive: true, force: true});
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

    return {outputFile, buildId, buildDir};
}

async function* generateFileStream(
    filePath: string,
    buildId: string,
    cleanupDir?: string
): AsyncGenerator<Uint8Array> {
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
        console.log(
            `[stream:${buildId.slice(0, 8)}] ` +
            `sent ${(bytesWritten / 1024).toFixed(1)}KB in ${streamTime.toFixed(0)}ms`
        );

        if (cleanupDir) {
            const cleanupStart = performance.now();
            await rm(cleanupDir, {recursive: true, force: true}).catch(() => {});
            console.log(
                `[cleanup:${buildId.slice(0, 8)}] ` +
                `completed in ${(performance.now() - cleanupStart).toFixed(0)}ms`
            );
        }
    }
}

function streamFileAndCleanup(
    filePath: string,
    buildId: string,
    cleanupDir?: string
): Response {
    const file = Bun.file(filePath);

    return new Response(generateFileStream(filePath, buildId, cleanupDir), {
        headers: {
            "Content-Type": "application/javascript",
            "Content-Disposition": `attachment; filename="prebid.js"`,
            "Content-Length": String(file.size),
        },
    });
}

const server = Bun.serve({
    port: PORT,
    routes: {
        "/bundle/:version": {
            POST: async (req) => {
                const requestStart = performance.now();
                const version = parseVersion(req.params.version);
                if (!version) {
                    return Response.json({error: "Invalid version format"}, {status: 400});
                }

                let body: BundleRequest;
                try {
                    body = await req.json() as BundleRequest;
                } catch {
                    return Response.json({error: "Invalid JSON body"}, {status: 400});
                }

                if (!Array.isArray(body?.modules) || body?.modules?.length === 0) {
                    return Response.json({error: "modules array is required"}, {status: 400});
                }

                console.log(
                    `[request] POST /bundle/${version} with ${body.modules.length} modules: ` +
                    `${body.modules.slice(0, 3).join(", ")}${body.modules.length > 3 ? "..." : ""}`
                );

                try {
                    const {outputFile, buildId, buildDir} = await buildBundle(version, body.modules);
                    const cleanupDir = outputFile.includes(BUILDS_DIR) ? buildDir : undefined;

                    console.log(
                        `[request:${buildId.slice(0, 8)}] ` +
                        `ready to stream after ${(performance.now() - requestStart).toFixed(0)}ms`
                    );

                    return streamFileAndCleanup(outputFile, buildId, cleanupDir);
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Build failed";
                    console.error(`[error] ${message}`);
                    return Response.json({error: message}, {status: 500});
                }
            },
        },
        "/modules/:version": {
            GET: async (req) => {
                const version = parseVersion(req.params.version);
                if (!version) {
                    return Response.json({error: "Invalid version format"}, {status: 400});
                }

                try {
                    const modules = await getModulesForVersion(version);
                    return Response.json({version, modules});
                } catch (error) {
                    const message = error instanceof Error ? error.message : "Unknown error";
                    return Response.json({error: message}, {status: 404});
                }
            },
        },
        "/versions": {
            GET: async () => {
                const versions = await getAvailableVersions();
                return Response.json({versions});
            },
        },
        "/health": {
            GET: () => Response.json({status: "ok"}),
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
            {status: 404}
        );
    },
});

console.log(`Server running at ${server.url}`);
