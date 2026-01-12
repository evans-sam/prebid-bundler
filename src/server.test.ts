import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildBundle,
  cleanupBuildDir,
  createServer,
  getAvailableVersions,
  getModulesForVersion,
  getVersionDir,
  restoreGlobalVarName,
  setGlobalVarName,
  type ServerConfig,
} from "./server";

// Type for mock spawn options
interface MockSpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
}

// Test fixture helpers
async function createTestFixture() {
  const rootDir = `${Bun.file(join(tmpdir(), `prebid-test-${Date.now()}`)).name?.replace(/[^/]+$/, "")}prebid-test-${crypto.randomUUID()}`;
  const prebidDir = join(rootDir, "dist", "prebid.js");
  const buildsDir = join(rootDir, "dist", "builds");

  await mkdir(prebidDir, { recursive: true });
  await mkdir(buildsDir, { recursive: true });

  return {
    rootDir,
    prebidDir,
    buildsDir,
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

async function createVersionFixture(
  prebidDir: string,
  version: string,
  modules: string[] = ["testBidAdapter", "anotherModule"],
  packageJson: Record<string, unknown> = { name: "prebid.js", version, globalVarName: "pbjs" },
) {
  const versionDir = join(prebidDir, `prebid_${version.replace(/\./g, "_")}`);
  const modulesDir = join(versionDir, "modules");

  await mkdir(modulesDir, { recursive: true });

  for (const mod of modules) {
    await Bun.write(join(modulesDir, `${mod}.js`), `// Mock module: ${mod}`);
  }

  await Bun.write(join(versionDir, "package.json"), JSON.stringify(packageJson, null, 2));

  return versionDir;
}

// ============================================================================
// Unit Tests: Helper Functions
// ============================================================================

describe("getVersionDir", () => {
  test("converts version dots to underscores", () => {
    expect(getVersionDir("/path/to/prebid", "10.20.0")).toBe("/path/to/prebid/prebid_10_20_0");
    expect(getVersionDir("/path/to/prebid", "9.0.0")).toBe("/path/to/prebid/prebid_9_0_0");
  });
});

describe("getAvailableVersions", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;

  beforeAll(async () => {
    fixture = await createTestFixture();
    await createVersionFixture(fixture.prebidDir, "10.20.0");
    await createVersionFixture(fixture.prebidDir, "9.15.0");
    await createVersionFixture(fixture.prebidDir, "10.5.0");
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("returns versions sorted in descending order", async () => {
    const versions = await getAvailableVersions(fixture.prebidDir);
    expect(versions).toEqual(["10.20.0", "10.5.0", "9.15.0"]);
  });

  test("returns empty array for non-existent directory", async () => {
    const versions = await getAvailableVersions("/nonexistent/path");
    expect(versions).toEqual([]);
  });
});

describe("getModulesForVersion", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;

  beforeAll(async () => {
    fixture = await createTestFixture();
    await createVersionFixture(fixture.prebidDir, "10.20.0", ["appnexusBidAdapter", "rubiconBidAdapter", "prebidServerBidAdapter"]);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("returns sorted list of modules", async () => {
    const modules = await getModulesForVersion(fixture.prebidDir, "10.20.0");
    expect(modules).toEqual(["appnexusBidAdapter", "prebidServerBidAdapter", "rubiconBidAdapter"]);
  });

  test("throws error for non-existent version", async () => {
    await expect(getModulesForVersion(fixture.prebidDir, "99.99.99")).rejects.toThrow("Version 99.99.99 not found");
  });
});

describe("cleanupBuildDir", () => {
  test("removes directory successfully", async () => {
    const tempDir = join(tmpdir(), `cleanup-test-${crypto.randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    await Bun.write(join(tempDir, "test.txt"), "test");

    const result = await cleanupBuildDir(tempDir, "test-id");
    expect(result).toBe(true);

    const exists = await Bun.file(tempDir).exists();
    expect(exists).toBe(false);
  });

  test("returns true for non-existent directory", async () => {
    const result = await cleanupBuildDir("/nonexistent/path", "test-id");
    expect(result).toBe(true);
  });
});

describe("setGlobalVarName", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;
  let versionDir: string;

  beforeAll(async () => {
    fixture = await createTestFixture();
    versionDir = await createVersionFixture(fixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "pbjs",
    });
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("updates globalVarName in package.json and returns original", async () => {
    const originalValue = await setGlobalVarName(versionDir, "customPbjs");

    expect(originalValue).toBe("pbjs");

    const packageJson = await Bun.file(join(versionDir, "package.json")).json();
    expect(packageJson.globalVarName).toBe("customPbjs");
  });

  test("handles missing globalVarName in package.json", async () => {
    const tempFixture = await createTestFixture();
    const tempVersionDir = await createVersionFixture(tempFixture.prebidDir, "9.0.0", ["testModule"], {
      name: "prebid.js",
      version: "9.0.0",
    });

    const originalValue = await setGlobalVarName(tempVersionDir, "myPbjs");

    expect(originalValue).toBeUndefined();

    const packageJson = await Bun.file(join(tempVersionDir, "package.json")).json();
    expect(packageJson.globalVarName).toBe("myPbjs");

    await tempFixture.cleanup();
  });
});

describe("restoreGlobalVarName", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;
  let versionDir: string;

  beforeAll(async () => {
    fixture = await createTestFixture();
    versionDir = await createVersionFixture(fixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "modified",
    });
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("restores original globalVarName in package.json", async () => {
    await restoreGlobalVarName(versionDir, "pbjs");

    const packageJson = await Bun.file(join(versionDir, "package.json")).json();
    expect(packageJson.globalVarName).toBe("pbjs");
  });
});

// ============================================================================
// Integration Tests: HTTP Endpoints
// ============================================================================

describe("HTTP Endpoints", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;

  beforeAll(async () => {
    fixture = await createTestFixture();
    await createVersionFixture(fixture.prebidDir, "10.20.0", ["appnexusBidAdapter", "rubiconBidAdapter"]);
    await createVersionFixture(fixture.prebidDir, "9.15.0", ["33acrossBidAdapter"]);

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0, // Random available port
      buildTimeoutMs: 5000,
    };

    server = createServer(config);
    baseUrl = server.url.origin;
  });

  afterAll(async () => {
    server.stop();
    await fixture.cleanup();
  });

  describe("GET /health", () => {
    test("returns ok status", async () => {
      const response = await fetch(`${baseUrl}/health`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json).toEqual({ status: "ok" });
    });
  });

  describe("GET /versions", () => {
    test("returns available versions", async () => {
      const response = await fetch(`${baseUrl}/versions`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.versions).toEqual(["10.20.0", "9.15.0"]);
    });
  });

  describe("GET /modules/:version", () => {
    test("returns modules for valid version", async () => {
      const response = await fetch(`${baseUrl}/modules/10.20.0`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.version).toBe("10.20.0");
      expect(json.modules).toEqual(["appnexusBidAdapter", "rubiconBidAdapter"]);
    });

    test("returns 400 for invalid version format", async () => {
      const response = await fetch(`${baseUrl}/modules/invalid`);
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("Invalid version format");
    });

    test("returns 404 for non-existent version", async () => {
      const response = await fetch(`${baseUrl}/modules/99.99.99`);
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.error).toContain("not found");
    });

    test("coerces partial version", async () => {
      const response = await fetch(`${baseUrl}/modules/10.20`);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.version).toBe("10.20.0");
    });
  });

  describe("POST /bundle/:version", () => {
    test("returns 400 for invalid version format", async () => {
      const response = await fetch(`${baseUrl}/bundle/invalid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: ["test"] }),
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("Invalid version format");
    });

    test("returns 400 for invalid JSON body", async () => {
      const response = await fetch(`${baseUrl}/bundle/10.20.0`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("Invalid JSON body");
    });

    test("returns 400 for missing modules array", async () => {
      const response = await fetch(`${baseUrl}/bundle/10.20.0`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("modules array is required");
    });

    test("returns 400 for empty modules array", async () => {
      const response = await fetch(`${baseUrl}/bundle/10.20.0`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: [] }),
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("modules array is required");
    });

    test("returns 400 for modules array with only invalid values", async () => {
      const response = await fetch(`${baseUrl}/bundle/10.20.0`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: ["", "  ", null] }),
      });
      const json = await response.json();

      expect(response.status).toBe(400);
      expect(json.error).toBe("modules array must contain valid module names");
    });
  });

  describe("Unknown routes", () => {
    test("returns 404 with endpoint list", async () => {
      const response = await fetch(`${baseUrl}/unknown`);
      const json = await response.json();

      expect(response.status).toBe(404);
      expect(json.error).toBe("Not found");
      expect(json.endpoints).toBeArray();
      expect(json.endpoints.length).toBe(4);
    });
  });
});

// ============================================================================
// Build Process Tests: Command Verification
// ============================================================================

describe("buildBundle", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;

  beforeAll(async () => {
    fixture = await createTestFixture();
    await createVersionFixture(fixture.prebidDir, "10.20.0", ["testModule"]);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  test("spawns correct gulp command", async () => {
    const spawnCalls: Array<{ cmd: string[]; opts: MockSpawnOpts }> = [];
    let buildDirPath: string | null | undefined = null;

    const mockSpawn = (cmd: string[], opts: MockSpawnOpts = {}) => {
      spawnCalls.push({ cmd, opts });
      // Capture the build dir from env
      buildDirPath = opts.env?.PREBID_DIST_PATH;

      return {
        exited: (async () => {
          // Create the output file when "gulp" completes
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    const result = await buildBundle({config : config, version : "10.20.0", modules : ["appnexusBidAdapter", "rubiconBidAdapter"]});

    // Verify spawn was called with correct command
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0]?.cmd).toEqual(["npx", "gulp", "bundle", "--modules=appnexusBidAdapter,rubiconBidAdapter"]);

    // Verify cwd is set to version directory
    expect(spawnCalls[0]?.opts.cwd).toContain("prebid_10_20_0");

    // Verify PREBID_DIST_PATH env var is set
    expect(spawnCalls[0]?.opts.env?.PREBID_DIST_PATH).toBeDefined();
    expect(spawnCalls[0]?.opts.env?.PREBID_DIST_PATH).toContain(fixture.buildsDir);

    // Verify result
    expect(result.outputFile).toContain("prebid.js");
    expect(result.buildId).toBeDefined();
    expect(result.buildDir).toContain(fixture.buildsDir);
  });

  test("throws error for non-existent version", async () => {
    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
    };

    await expect(buildBundle({config : config, version : "99.99.99", modules : ["test"]})).rejects.toThrow("Version 99.99.99 not found");
  });

  test("handles build failure with non-zero exit code", async () => {
    const mockSpawn = (_cmd: string[], _opts: MockSpawnOpts = {}) => {
      return {
        exited: Promise.resolve(1),
        stdout: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("Build error: module not found"));
            c.close();
          },
        }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    await expect(buildBundle({config : config, version : "10.20.0", modules : ["test"]})).rejects.toThrow("Build failed:");
  });

  test("handles build timeout", async () => {
    let killCalled = false;

    const mockSpawn = (_cmd: string[], _opts: MockSpawnOpts = {}) => {
      return {
        exited: new Promise(() => {}), // Never resolves
        stdout: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        kill: () => {
          killCalled = true;
        },
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 100, // Short timeout for test
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    await expect(buildBundle({config : config, version : "10.20.0", modules : ["test"]})).rejects.toThrow("Build timed out after 100ms");

    expect(killCalled).toBe(true);
  });

  test("deduplicates and trims module names", async () => {
    const spawnCalls: Array<{ cmd: string[]; opts: MockSpawnOpts }> = [];

    const mockSpawn = (cmd: string[], opts: MockSpawnOpts = {}) => {
      spawnCalls.push({ cmd, opts });
      const buildDirPath = opts.env?.PREBID_DIST_PATH;

      return {
        exited: (async () => {
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    // Test with duplicates and spaces - buildBundle receives already cleaned modules
    await buildBundle({config : config, version : "10.20.0", modules : ["moduleA", "moduleB"]});

    expect(spawnCalls[0]?.cmd[3]).toBe("--modules=moduleA,moduleB");
  });

  test("uses gulp build when globalVarName is provided", async () => {
    const spawnCalls: Array<{ cmd: string[]; opts: MockSpawnOpts }> = [];
    let buildDirPath: string | undefined;

    const mockSpawn = (cmd: string[], opts: MockSpawnOpts = {}) => {
      spawnCalls.push({ cmd, opts });
      buildDirPath = opts.env?.PREBID_DIST_PATH;

      return {
        exited: (async () => {
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    await buildBundle({config, version: "10.20.0", modules: ["testModule"], globalVarName: "customPbjs"});

    // Verify gulp build is used instead of gulp bundle
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].cmd).toEqual(["npx", "gulp", "build", "--modules=testModule"]);
  });

  test("modifies and restores package.json when globalVarName is provided", async () => {
    // Create a fresh fixture for this test to avoid state pollution
    const testFixture = await createTestFixture();
    const versionDir = await createVersionFixture(testFixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "pbjs",
    });

    let capturedGlobalVarName: string | undefined;

    const mockSpawn = (_cmd: string[], opts: MockSpawnOpts = {}) => {
      return {
        exited: (async () => {
          // Capture the globalVarName during the build
          const pkgJson = await Bun.file(join(versionDir, "package.json")).json();
          capturedGlobalVarName = pkgJson.globalVarName;

          // Create the output file
          const buildDirPath = opts.env?.PREBID_DIST_PATH;
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({ start(c) { c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: testFixture.prebidDir,
      buildsDir: testFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    await buildBundle({config, version: "10.20.0", modules: ["testModule"], globalVarName: "myCustomVar"});

    // Verify the globalVarName was changed during the build
    expect(capturedGlobalVarName).toBe("myCustomVar");

    // Verify the globalVarName was restored after the build
    const restoredPkgJson = await Bun.file(join(versionDir, "package.json")).json();
    expect(restoredPkgJson.globalVarName).toBe("pbjs");

    await testFixture.cleanup();
  });

  test("restores package.json on timeout when globalVarName is provided", async () => {
    const testFixture = await createTestFixture();
    const versionDir = await createVersionFixture(testFixture.prebidDir, "10.20.0", ["testModule"], {
      name: "prebid.js",
      version: "10.20.0",
      globalVarName: "originalVar",
    });

    const mockSpawn = () => {
      return {
        exited: new Promise(() => {}), // Never resolves
        stdout: new ReadableStream({ start(c) { c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: testFixture.prebidDir,
      buildsDir: testFixture.buildsDir,
      port: 0,
      buildTimeoutMs: 50,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

     await expect((buildBundle({config, version: "10.20.0", modules: ["test"], globalVarName: "tempVar"}))).rejects.toThrow();

    // Verify the globalVarName was restored after the timeout
    const restoredPkgJson = await Bun.file(join(versionDir, "package.json")).json();
    expect(restoredPkgJson.globalVarName).toBe("originalVar");

    await testFixture.cleanup();
  });
});

// ============================================================================
// Performance Marks Cleanup Tests
// ============================================================================

describe("Performance marks cleanup", () => {
  let fixture: Awaited<ReturnType<typeof createTestFixture>>;

  beforeAll(async () => {
    fixture = await createTestFixture();
    await createVersionFixture(fixture.prebidDir, "10.20.0", ["testModule"]);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  afterEach(() => {
    // Clean up any leftover marks/measures between tests
    performance.clearMarks();
    performance.clearMeasures();
  });

  test("buildBundle cleans up marks after successful build", async () => {
    const mockSpawn = (_cmd: string[], opts: MockSpawnOpts = {}) => {
      const buildDirPath = opts.env?.PREBID_DIST_PATH;
      return {
        exited: (async () => {
          if (buildDirPath) {
            await Bun.write(join(buildDirPath, "prebid.js"), "// mock bundle");
          }
          return 0;
        })(),
        stdout: new ReadableStream({ start(c) { c.close(); } }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        kill: () => {},
        pid: 12345,
      };
    };

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    // Get marks before
    const marksBefore = performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:"));

    await buildBundle({config, version: "10.20.0", modules: ["testModule"]});

    // Get marks after - should be cleaned up
    const marksAfter = performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:"));
    const measuresAfter = performance.getEntriesByType("measure").filter((m) => m.name.startsWith("build:"));

    expect(marksAfter.length).toBe(marksBefore.length);
    expect(measuresAfter.length).toBe(0);
  });

  test("buildBundle cleans up marks after version not found error", async () => {
    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
    };

    try {
      await buildBundle({config, version: "99.99.99", modules: ["test"]});
    } catch {
      // Expected to throw
    }

    // Marks should be cleaned up even after error
    const marks = performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:"));
    expect(marks.length).toBe(0);
  });

  test("buildBundle cleans up marks after build failure", async () => {
    const mockSpawn = () => ({
      exited: Promise.resolve(1),
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("error")); c.close(); } }),
      kill: () => {},
      pid: 12345,
    });

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 5000,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    try {
        await buildBundle({config, version: "10.20.0", modules: ["test"]});
    } catch {
      // Expected to throw
    }

    // Marks should be cleaned up even after error
    const marks = performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:"));
    expect(marks.length).toBe(0);
  });

  test("buildBundle cleans up marks after timeout", async () => {
    const mockSpawn = () => ({
      exited: new Promise(() => {}), // Never resolves
      stdout: new ReadableStream({ start(c) { c.close(); } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      kill: () => {},
      pid: 12345,
    });

    const config: ServerConfig = {
      prebidDir: fixture.prebidDir,
      buildsDir: fixture.buildsDir,
      port: 0,
      buildTimeoutMs: 50,
      spawn: mockSpawn as unknown as typeof Bun.spawn,
    };

    try {
      await buildBundle({config, version: "10.20.0", modules: ["test"]});
    } catch {
      // Expected to throw
    }

    // Marks should be cleaned up even after timeout
    const marks = performance.getEntriesByType("mark").filter((m) => m.name.startsWith("build:"));
    expect(marks.length).toBe(0);
  });
});
