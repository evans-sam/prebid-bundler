# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prebid-bundler is a Bun-based service that manages multiple Prebid.js versions and provides an HTTP API to build custom Prebid bundles with specified modules. It can run locally, as a CLI tool, or in Docker.

## Commands

```bash
bun install              # Install dependencies
bun run dev              # Development server with hot reload (port 8787)
bun run start            # Production server
bun run checkout         # Checkout Prebid.js versions to dist/prebid.js/
bun test                 # Run tests
bun test src/server.test.ts  # Run specific test file
bun run lint             # Run Biome linter
bun run lint:fix         # Auto-fix lint issues
bun run format           # Format code with Biome
```

## Architecture

### Core Components

- **`src/server.ts`** - HTTP server using `Bun.serve()` with routes for `/versions`, `/modules/:version`, `/bundle/:version`, and `/health`. The `buildBundle()` function spawns `npx gulp bundle` in the appropriate Prebid version directory.

- **`src/commands/checkout.ts`** - Clones Prebid.js repo and builds specific versions. Versions are stored in `dist/prebid.js/prebid_X_Y_Z/` (dots replaced with underscores).

- **`bin/cli.ts`** - CLI entry point with subcommands: `init`, `build`, `checkout`, `serve`.

- **`src/utils.ts`** - Version parsing using semver coercion.

### Data Flow

1. `checkout` command clones/builds Prebid.js versions into `dist/prebid.js/prebid_X_Y_Z/`
2. Server reads available versions by scanning directory names
3. `/bundle/:version` POST endpoint spawns `gulp bundle` with modules, outputs to `dist/builds/{uuid}/`
4. Built file is streamed to client, build directory cleaned up after

### Key Patterns

- Version directories use underscores: `prebid_10_20_0` for version `10.20.0`
- Build isolation: each bundle build gets a unique UUID directory
- Timeout handling: builds have configurable timeout with process termination
- Mock injection: `ServerConfig.spawn` allows test injection of spawn behavior

## Environment Variables

- `PORT` - Server port (default: 8787)
- `BUILD_TIMEOUT_MS` - Gulp build timeout in ms (default: 60000)
- `PREBID_GLOBAL_VAR_NAME` - Custom global variable name for Prebid builds

## Docker

```bash
# Build with specific version
docker build --build-arg PREBID_VERSION=10.20.0 -t prebid-bundler:10.20.0 .

# Build with N most recent versions
docker build --build-arg PREBID_COUNT=5 -t prebid-bundler .
```

## Use Bun, Not Node

- Use `bun <file>` instead of `node <file>`
- Use `bun test` instead of jest/vitest
- Use `Bun.serve()` instead of express
- Use `Bun.file()` instead of fs.readFile/writeFile
- Use `Bun.$` for shell commands instead of execa
- Bun auto-loads `.env` - don't use dotenv
