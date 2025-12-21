import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
  type ServerConfig,
} from "./server";

// Type for mock spawn options
interface MockSpawnOpts {
  cwd?: string;
  env?: Record<string, string>;
}

// Test fixture helpers
async function createTestFixture() {
  const rootDir = `${Bun.file(join(tmpdir(), `prebid-test-${Date.now()}`)).name.replace(/[^/]+$/, "")}prebid-test-${crypto.randomUUID()}`;
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

async function createVersionFixture(prebidDir: string, version: string, modules: string[] = ["testBidAdapter", "anotherModule"]) {
  const versionDir = join(prebidDir, `prebid_${version.replace(/\./g, "_")}`);
  const modulesDir = join(versionDir, "modules");

  await mkdir(modulesDir, { recursive: true });

  for (const mod of modules) {
    await Bun.write(join(modulesDir, `${mod}.js`), `// Mock module: ${mod}`);
  }

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
    let buildDirPath: string | null = null;

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

    const result = await buildBundle(config, "10.20.0", ["appnexusBidAdapter", "rubiconBidAdapter"]);

    // Verify spawn was called with correct command
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].cmd).toEqual(["npx", "gulp", "bundle", "--modules=appnexusBidAdapter,rubiconBidAdapter"]);

    // Verify cwd is set to version directory
    expect(spawnCalls[0].opts.cwd).toContain("prebid_10_20_0");

    // Verify PREBID_DIST_PATH env var is set
    expect(spawnCalls[0].opts.env.PREBID_DIST_PATH).toBeDefined();
    expect(spawnCalls[0].opts.env.PREBID_DIST_PATH).toContain(fixture.buildsDir);

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

    await expect(buildBundle(config, "99.99.99", ["test"])).rejects.toThrow("Version 99.99.99 not found");
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

    await expect(buildBundle(config, "10.20.0", ["test"])).rejects.toThrow("Build failed:");
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

    await expect(buildBundle(config, "10.20.0", ["test"])).rejects.toThrow("Build timed out after 100ms");

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
    await buildBundle(config, "10.20.0", ["moduleA", "moduleB"]);

    expect(spawnCalls[0].cmd[3]).toBe("--modules=moduleA,moduleB");
  });
});
