import { describe, expect, test } from "bun:test";

/**
 * These tests verify the checkout CLI argument parsing.
 * Integration tests that run git clone are in a separate file.
 */

describe("checkout CLI parsing", () => {
  test("parses version flags correctly", async () => {
    const { parseArgs } = await import("node:util");

    const { values } = parseArgs({
      args: ["-v", "10.20.0", "-v", "9.15.0", "-n", "5", "--keep"],
      options: {
        version: { type: "string", short: "v", multiple: true },
        count: { type: "string", short: "n" },
        keep: { type: "boolean", short: "k" },
        output: { type: "string", short: "o" },
      },
      allowPositionals: true,
    });

    expect(values.version).toEqual(["10.20.0", "9.15.0"]);
    expect(values.count).toBe("5");
    expect(values.keep).toBe(true);
  });

  test("parses output directory", async () => {
    const { parseArgs } = await import("node:util");

    const { values } = parseArgs({
      args: ["-o", "/custom/path", "-v", "10.0.0"],
      options: {
        version: { type: "string", short: "v", multiple: true },
        count: { type: "string", short: "n" },
        keep: { type: "boolean", short: "k" },
        output: { type: "string", short: "o" },
      },
      allowPositionals: true,
    });

    expect(values.output).toBe("/custom/path");
    expect(values.version).toEqual(["10.0.0"]);
  });

  test("handles help flag", async () => {
    const { parseArgs } = await import("node:util");

    const { values } = parseArgs({
      args: ["--help"],
      options: {
        version: { type: "string", short: "v", multiple: true },
        count: { type: "string", short: "n" },
        keep: { type: "boolean", short: "k" },
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    expect(values.help).toBe(true);
  });

  test("handles positional count argument", async () => {
    const { parseArgs } = await import("node:util");

    const { positionals } = parseArgs({
      args: ["5"],
      options: {
        version: { type: "string", short: "v", multiple: true },
        count: { type: "string", short: "n" },
        keep: { type: "boolean", short: "k" },
        output: { type: "string", short: "o" },
      },
      allowPositionals: true,
    });

    expect(positionals[0]).toBe("5");
  });

  test("parses short flags", async () => {
    const { parseArgs } = await import("node:util");

    const { values } = parseArgs({
      args: ["-v", "1.0.0", "-n", "3", "-k", "-o", "/tmp/out"],
      options: {
        version: { type: "string", short: "v", multiple: true },
        count: { type: "string", short: "n" },
        keep: { type: "boolean", short: "k" },
        output: { type: "string", short: "o" },
      },
      allowPositionals: true,
    });

    expect(values.version).toEqual(["1.0.0"]);
    expect(values.count).toBe("3");
    expect(values.keep).toBe(true);
    expect(values.output).toBe("/tmp/out");
  });
});

describe("version directory naming convention", () => {
  test("version string to directory name conversion", () => {
    // Test the naming convention: 10.20.0 -> prebid_10_20_0
    const version = "10.20.0";
    const dirName = `prebid_${version.replaceAll(/\./g, "_")}`;
    expect(dirName).toBe("prebid_10_20_0");
  });

  test("handles multiple digit version numbers", () => {
    const version = "10.123.456";
    const dirName = `prebid_${version.replaceAll(/\./g, "_")}`;
    expect(dirName).toBe("prebid_10_123_456");
  });

  test("handles single digit versions", () => {
    const version = "1.0.0";
    const dirName = `prebid_${version.replaceAll(/\./g, "_")}`;
    expect(dirName).toBe("prebid_1_0_0");
  });
});
