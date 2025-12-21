import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { $ } from "bun";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Package root is two levels up from src/commands/
const PACKAGE_ROOT = resolve(__dirname, "../..");
const DOCKERFILE_PATH = resolve(PACKAGE_ROOT, "Dockerfile");

interface BuildOptions {
  versions?: string[];
  count?: number;
  tag: string;
  push: boolean;
  platform?: string;
  buildContext?: string;
  dockerfile?: string;
  noCache: boolean;
  quiet: boolean;
}

export async function build(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
      versions: { type: "string", short: "v" },
      count: { type: "string", short: "n" },
      tag: { type: "string", short: "t" },
      push: { type: "boolean", short: "p" },
      platform: { type: "string" },
      context: { type: "string", short: "c" },
      dockerfile: { type: "string", short: "f" },
      "no-cache": { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
prebid-bundler build - Build a Docker image with Prebid.js versions

Usage: prebid-bundler build [options]

Options:
  -h, --help              Show this help message
  -v, --versions <list>   Comma-separated list of Prebid versions (e.g., "10.20.0,9.53.5")
  -n, --count <num>       Number of recent versions to include (default: 2)
  -t, --tag <name>        Docker image tag (default: prebid-bundler:latest)
  -p, --push              Push image to registry after building
  --platform <platform>   Target platform (e.g., linux/amd64,linux/arm64)
  -c, --context <dir>     Build context directory (default: package's docker dir)
  -f, --dockerfile <path> Path to Dockerfile (default: package's Dockerfile)
  --no-cache              Build without using cache
  -q, --quiet             Suppress build output

Examples:
  prebid-bundler build
  prebid-bundler build --versions 10.20.0,9.53.5 --tag my-prebid:v1
  prebid-bundler build --count 5 --tag prebid:5-versions
  prebid-bundler build --platform linux/amd64 --push

Notes:
  - By default, uses the Dockerfile from the prebid-bundler package
  - Use 'prebid-bundler init' to copy Docker files to your project for customization
`);
    process.exit(0);
  }

  const options: BuildOptions = {
    versions: values.versions?.split(",").map((v) => v.trim()),
    count: values.count ? parseInt(values.count, 10) : undefined,
    tag: values.tag ?? "prebid-bundler:latest",
    push: values.push ?? false,
    platform: values.platform,
    buildContext: values.context,
    dockerfile: values.dockerfile,
    noCache: values["no-cache"] ?? false,
    quiet: values.quiet ?? false,
  };

  await buildDockerImage(options);
}

async function buildDockerImage(options: BuildOptions) {
  const { versions, count, tag, push, platform, buildContext, dockerfile, noCache, quiet } = options;

  // Determine Dockerfile location
  const dockerfilePath = dockerfile ?? DOCKERFILE_PATH;
  if (!existsSync(dockerfilePath)) {
    console.error(`Error: Dockerfile not found at ${dockerfilePath}`);
    process.exit(1);
  }

  // Determine build context - use package root since Dockerfile needs src/, checkout.ts, etc.
  const contextPath = buildContext ?? PACKAGE_ROOT;
  if (!existsSync(contextPath)) {
    console.error(`Error: Build context not found at ${contextPath}`);
    process.exit(1);
  }

  // Build the docker command
  const dockerArgs: string[] = ["build"];

  // Add dockerfile flag
  dockerArgs.push("-f", dockerfilePath);

  // Add tag
  dockerArgs.push("-t", tag);

  // Add build args for versions
  if (versions && versions.length > 0) {
    // For multiple specific versions, we pass the first one as PREBID_VERSION
    // The Dockerfile would need modification to support multiple specific versions
    // For now, we support single version or count
    if (versions.length === 1) {
      dockerArgs.push("--build-arg", `PREBID_VERSION=${versions[0]}`);
    } else {
      // For multiple versions, we'll need to use a different approach
      // Pass as comma-separated list
      dockerArgs.push("--build-arg", `PREBID_VERSIONS=${versions.join(",")}`);
    }
  } else if (count !== undefined) {
    dockerArgs.push("--build-arg", `PREBID_COUNT=${count}`);
  }

  // Add platform if specified
  if (platform) {
    dockerArgs.push("--platform", platform);
  }

  // Add no-cache flag
  if (noCache) {
    dockerArgs.push("--no-cache");
  }

  // Add quiet flag
  if (quiet) {
    dockerArgs.push("--quiet");
  }

  // Add build context
  dockerArgs.push(contextPath);

  console.log(`Building Docker image: ${tag}`);
  if (!quiet) {
    console.log(`  Dockerfile: ${dockerfilePath}`);
    console.log(`  Context: ${contextPath}`);
    if (versions) {
      console.log(`  Versions: ${versions.join(", ")}`);
    } else if (count) {
      console.log(`  Version count: ${count}`);
    } else {
      console.log(`  Version count: 2 (default)`);
    }
    console.log("");
  }

  try {
    const result = await $`docker ${dockerArgs}`.nothrow();

    if (result.exitCode !== 0) {
      console.error("Docker build failed");
      process.exit(result.exitCode);
    }

    console.log(`\nSuccessfully built: ${tag}`);

    // Push if requested
    if (push) {
      console.log(`\nPushing ${tag}...`);
      const pushResult = await $`docker push ${tag}`.nothrow();

      if (pushResult.exitCode !== 0) {
        console.error("Docker push failed");
        process.exit(pushResult.exitCode);
      }

      console.log(`Successfully pushed: ${tag}`);
    }
  } catch (error) {
    console.error("Error running docker command:", error);
    process.exit(1);
  }
}

// Export for programmatic use
export async function buildImage(options: Partial<BuildOptions> = {}) {
  const defaults: BuildOptions = {
    tag: "prebid-bundler:latest",
    push: false,
    noCache: false,
    quiet: false,
  };

  return buildDockerImage({ ...defaults, ...options });
}
