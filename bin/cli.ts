#!/usr/bin/env bun
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root is one level up from bin/
export const PACKAGE_ROOT = resolve(__dirname, "..");

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "V" },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0];

async function showHelp() {
  console.log(`
prebid-bundler - Build and serve custom Prebid.js bundles

Usage: prebid-bundler <command> [options]

Commands:
  init              Initialize Docker files in your project
  build             Build a Docker image with specified Prebid versions
  checkout          Clone and build Prebid.js versions locally
  serve             Start the bundler HTTP server

Options:
  -h, --help        Show this help message
  -V, --version     Show version number

Examples:
  prebid-bundler init
  prebid-bundler build --versions 10.20.0,9.53.5 --tag my-prebid
  prebid-bundler checkout -n 5
  prebid-bundler serve

Run 'prebid-bundler <command> --help' for more information on a command.
`);
}

async function showVersion() {
  const pkg = await Bun.file(resolve(PACKAGE_ROOT, "package.json")).json();
  console.log(`prebid-bundler v${pkg.version || "0.0.0"}`);
}

async function main() {
  // Only show main help if --help without a command, or no command at all
  if (!command) {
    if (values.help) {
      await showHelp();
      process.exit(0);
    }
    if (values.version) {
      await showVersion();
      process.exit(0);
    }
    await showHelp();
    process.exit(0);
  }

  // Pass all args after the command to the subcommand (including --help)
  const commandArgs = Bun.argv.slice(3);

  switch (command) {
    case "init": {
      const { init } = await import("../src/commands/init.js");
      await init(commandArgs);
      break;
    }
    case "build": {
      const { build } = await import("../src/commands/build.js");
      await build(commandArgs);
      break;
    }
    case "checkout": {
      const { checkout } = await import("../src/commands/checkout.js");
      await checkout(commandArgs);
      break;
    }
    case "serve": {
      const { serve } = await import("../src/commands/serve.js");
      await serve(commandArgs);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      await showHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
