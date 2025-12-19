import { parseArgs } from "util";
import { resolve, dirname, join, relative } from "path";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";
import { $ } from "bun";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root is two levels up from src/commands/
const PACKAGE_ROOT = resolve(__dirname, "../..");
const DOCKER_DIR = resolve(PACKAGE_ROOT, "docker");

interface InitOptions {
  force: boolean;
  outputDir: string;
  withCompose: boolean;
  full: boolean;
}

export async function init(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
      force: { type: "boolean", short: "f" },
      output: { type: "string", short: "o" },
      compose: { type: "boolean", short: "c" },
      full: { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
prebid-bundler init - Initialize Docker files in your project

Usage: prebid-bundler init [options]

Options:
  -h, --help          Show this help message
  -f, --force         Overwrite existing files
  -o, --output <dir>  Output directory (default: current directory)
  -c, --compose       Also create docker-compose.yml
  --full              Copy all source files (for standalone builds without the package)

Modes:
  Default mode:  Copies Dockerfile and .dockerignore. The Dockerfile references
                 files from node_modules/prebid-bundler, so the package must
                 remain installed.

  Full mode:     Copies all source files needed for standalone Docker builds.
                 Use this if you want to fully own/customize the bundler or
                 don't want to keep the package as a dependency.

Examples:
  prebid-bundler init                  # Minimal - uses package from node_modules
  prebid-bundler init --full           # Full - standalone, no dependency needed
  prebid-bundler init --compose        # Include docker-compose.yml
  prebid-bundler init -o ./docker      # Output to ./docker directory
`);
    process.exit(0);
  }

  const options: InitOptions = {
    force: values.force ?? false,
    outputDir: values.output ?? process.cwd(),
    withCompose: values.compose ?? false,
    full: values.full ?? false,
  };

  await initDockerFiles(options);
}

async function copyDirectory(src: string, dest: string, force: boolean): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      const result = await copyDirectory(srcPath, destPath, force);
      copied += result.copied;
      skipped += result.skipped;
    } else {
      if (existsSync(destPath) && !force) {
        skipped++;
      } else {
        const content = await Bun.file(srcPath).arrayBuffer();
        await Bun.write(destPath, content);
        copied++;
      }
    }
  }

  return { copied, skipped };
}

async function initDockerFiles(options: InitOptions) {
  const { force, outputDir, withCompose, full } = options;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let copiedCount = 0;
  let skippedCount = 0;

  if (full) {
    // Full mode: copy all source files for standalone builds
    console.log("Initializing full prebid-bundler setup...\n");

    // Copy source directory
    console.log("  Copying src/...");
    const srcResult = await copyDirectory(
      join(PACKAGE_ROOT, "src"),
      join(outputDir, "src"),
      force
    );
    copiedCount += srcResult.copied;
    skippedCount += srcResult.skipped;
    console.log(`    ${srcResult.copied} files copied, ${srcResult.skipped} skipped`);

    // Copy individual files
    const filesToCopy = [
      { src: join(DOCKER_DIR, "Dockerfile"), dest: "Dockerfile" },
      { src: join(DOCKER_DIR, ".dockerignore"), dest: ".dockerignore" },
      { src: join(PACKAGE_ROOT, "checkout.ts"), dest: "checkout.ts" },
      { src: join(PACKAGE_ROOT, "package.json"), dest: "package.json" },
    ];

    if (existsSync(join(PACKAGE_ROOT, "bun.lock"))) {
      filesToCopy.push({ src: join(PACKAGE_ROOT, "bun.lock"), dest: "bun.lock" });
    }

    if (withCompose) {
      filesToCopy.push({ src: join(DOCKER_DIR, "docker-compose.yml"), dest: "docker-compose.yml" });
    }

    for (const file of filesToCopy) {
      const destPath = join(outputDir, file.dest);

      if (!existsSync(file.src)) {
        console.warn(`  Warning: Source file not found: ${file.src}`);
        continue;
      }

      if (existsSync(destPath) && !force) {
        console.log(`  Skipped: ${file.dest} (already exists)`);
        skippedCount++;
        continue;
      }

      const content = await Bun.file(file.src).arrayBuffer();
      await Bun.write(destPath, content);
      console.log(`  Created: ${file.dest}`);
      copiedCount++;
    }

    console.log(`
Done! ${copiedCount} file(s) created, ${skippedCount} skipped.

Your project now contains a standalone prebid-bundler setup.

Next steps:
  1. Install dependencies:
     bun install

  2. Build your Docker image:
     docker build -t my-prebid-bundler .

  Or with specific versions:
     docker build --build-arg PREBID_VERSION=10.20.0 -t my-prebid-bundler .
     docker build --build-arg PREBID_COUNT=5 -t my-prebid-bundler .
${
  withCompose
    ? `
  Or use docker-compose:
     docker-compose up --build
`
    : ""
}
You can now customize the source code as needed.
`);
  } else {
    // Minimal mode: just Docker files that reference node_modules
    console.log("Initializing Docker files (minimal mode)...\n");

    // Create a Dockerfile that uses node_modules as context
    const dockerfileContent = `# Prebid Bundler Docker Image
#
# This Dockerfile builds from your node_modules/prebid-bundler package.
# To customize the bundler itself, run: prebid-bundler init --full
#
# Build Arguments:
#   PREBID_VERSION  - Specific version tag (e.g., 10.20.0)
#   PREBID_COUNT    - Number of recent versions (default: 2)
#
# Examples:
#   docker build -t prebid-bundler .
#   docker build --build-arg PREBID_COUNT=5 -t prebid-bundler .
#   docker build --build-arg PREBID_VERSION=10.20.0 -t prebid-bundler:10.20.0 .

FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies into temp directory for caching
FROM base AS install
RUN mkdir -p /temp/prod
COPY node_modules/prebid-bundler/package.json /temp/prod/
RUN cd /temp/prod && bun install --production

# Build prebid versions
FROM base AS prebid
ARG PREBID_VERSION
ARG PREBID_COUNT=2

# Install git and npm (required for checkout and building Prebid.js)
RUN apt-get update && apt-get install -y --no-install-recommends git npm \\
    && rm -rf /var/lib/apt/lists/*

COPY --from=install /temp/prod/node_modules node_modules
COPY node_modules/prebid-bundler/package.json ./
COPY node_modules/prebid-bundler/src ./src
COPY node_modules/prebid-bundler/checkout.ts ./

# Run checkout based on build args
RUN if [ -n "$PREBID_VERSION" ]; then \\
        bun checkout.ts --version "$PREBID_VERSION"; \\
    else \\
        bun checkout.ts --count "$PREBID_COUNT"; \\
    fi

# Final image
FROM base AS release

# Install npm for runtime gulp builds
RUN apt-get update && apt-get install -y --no-install-recommends npm \\
    && rm -rf /var/lib/apt/lists/* \\
    && npm cache clean --force

COPY --from=install /temp/prod/node_modules node_modules
COPY node_modules/prebid-bundler/src ./src
COPY node_modules/prebid-bundler/package.json .

# Copy prebid versions with ownership set
COPY --chown=bun:bun --from=prebid /usr/src/app/dist ./dist
RUN mkdir -p ./dist/builds ./dist/cache && chown -R bun:bun ./dist/builds ./dist/cache

ENV PORT=8787
USER bun
EXPOSE 8787/tcp
ENTRYPOINT ["bun", "run", "src/index.ts"]
`;

    const dockerignoreContent = `# Dependencies (we copy from node_modules/prebid-bundler specifically)
node_modules/
!node_modules/prebid-bundler/

# Build artifacts
dist/

# Git
.git/
.gitignore

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Test & Coverage
coverage/
.nyc_output/

# Environment
.env
.env.*
!.env.example

# Documentation
*.md
`;

    const composeContent = `# Prebid Bundler Docker Compose Configuration
#
# Usage:
#   docker-compose up --build              # Build and start with defaults
#   docker-compose up -d                   # Start in detached mode
#   docker-compose logs -f                 # Follow logs
#   docker-compose down                    # Stop and remove containers
#
# Environment Variables (set in .env or shell):
#   PREBID_COUNT    - Number of recent Prebid versions (default: 2)
#   PREBID_VERSION  - Specific Prebid version to build
#   PORT            - Host port to expose (default: 8787)

services:
  prebid-bundler:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        PREBID_COUNT: \${PREBID_COUNT:-2}
        # Uncomment to build specific version:
        # PREBID_VERSION: \${PREBID_VERSION:-}
    ports:
      - "\${PORT:-8787}:8787"
    environment:
      - PORT=8787
      - BUILD_TIMEOUT_MS=\${BUILD_TIMEOUT_MS:-60000}
    volumes:
      - prebid-cache:/usr/src/app/dist/cache
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8787/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  prebid-cache:
    name: prebid-bundler-cache
`;

    const filesToWrite = [
      { content: dockerfileContent, dest: "Dockerfile" },
      { content: dockerignoreContent, dest: ".dockerignore" },
    ];

    if (withCompose) {
      filesToWrite.push({ content: composeContent, dest: "docker-compose.yml" });
    }

    for (const file of filesToWrite) {
      const destPath = join(outputDir, file.dest);

      if (existsSync(destPath) && !force) {
        console.log(`  Skipped: ${file.dest} (already exists, use --force to overwrite)`);
        skippedCount++;
        continue;
      }

      await Bun.write(destPath, file.content);
      console.log(`  Created: ${file.dest}`);
      copiedCount++;
    }

    console.log(`
Done! ${copiedCount} file(s) created, ${skippedCount} skipped.

Next steps:
  1. Ensure prebid-bundler is installed:
     bun add prebid-bundler

  2. Build your Docker image:
     docker build -t my-prebid-bundler .

  Or with specific versions:
     docker build --build-arg PREBID_VERSION=10.20.0 -t my-prebid-bundler .
     docker build --build-arg PREBID_COUNT=5 -t my-prebid-bundler .
${
  withCompose
    ? `
  Or use docker-compose:
     docker-compose up --build
`
    : ""
}
To customize the bundler source code, run: prebid-bundler init --full
`);
  }
}
