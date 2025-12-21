import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { $ } from "bun";

interface CheckoutOptions {
  versions?: string[];
  count: number;
  keep: boolean;
  outputDir: string;
  globalVarName?: string;
}

export async function checkout(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    options: {
      version: { type: "string", short: "v", multiple: true },
      count: { type: "string", short: "n" },
      keep: { type: "boolean", short: "k" },
      output: { type: "string", short: "o" },
      "global-var-name": { type: "string", short: "g" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
prebid-bundler checkout - Clone and build Prebid.js versions

Usage: prebid-bundler checkout [options]

Options:
  -v, --version <tag>       Checkout a specific version (can be repeated)
  -n, --count <num>         Checkout the N most recent versions (default: 2)
  -k, --keep                Keep the working master clone for faster subsequent runs
  -o, --output <dir>        Output directory (default: ./dist/prebid.js)
  -g, --global-var-name <n> Set the Prebid global variable name (default: pbjs)
  -h, --help                Show this help message

Examples:
  prebid-bundler checkout                      # Checkout 2 most recent versions
  prebid-bundler checkout -n 5                 # Checkout 5 most recent versions
  prebid-bundler checkout -v 10.20.0           # Checkout specific version
  prebid-bundler checkout -v 10.20.0 -v 9.0.0  # Checkout multiple specific versions
  prebid-bundler checkout -n 3 --keep          # Keep working clone for faster runs
  prebid-bundler checkout -g myPrebid          # Use custom global variable name
`);
    process.exit(0);
  }

  const options: CheckoutOptions = {
    versions: values.version,
    count:
      parseInt(values.count ?? "", 10) ||
      parseInt(positionals[0] ?? "", 10) ||
      parseInt(process.env.NUMBER_OF_PREVIOUS_VERSIONS || "", 10) ||
      2,
    keep: values.keep || process.env.KEEP_WORKING_MASTER === "true",
    outputDir: values.output ?? resolve("dist/prebid.js"),
    globalVarName:
      values["global-var-name"] || process.env.PREBID_GLOBAL_VAR_NAME,
  };

  await checkoutVersions(options);
}

export async function checkoutVersions(options: CheckoutOptions) {
  const { versions, count, keep, outputDir, globalVarName } = options;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const workingMasterPath = join(outputDir, "working_master");

  if (!existsSync(workingMasterPath)) {
    console.log("=====> Cloning Prebid.js repository...");
    await $`git clone https://github.com/prebid/Prebid.js.git ${workingMasterPath}`;
  }

  await $`git -C ${workingMasterPath} fetch --tags`;

  // Determine which tags to checkout
  let tags: string[];

  if (versions && versions.length > 0) {
    // Specific versions requested
    tags = versions;
    console.log(`=====> Checking out ${tags.length} specific version(s): ${tags.join(", ")}`);
  } else {
    // Get N most recent versions
    const tagsOutput = await $`git -C ${workingMasterPath} tag --sort=-creatordate`.text();
    tags = tagsOutput.trim().split("\n").slice(0, count);
    console.log(`=====> Checking out ${count} most recent version(s)`);
  }

  let successCount = 0;
  let failCount = 0;

  for (const tag of tags) {
    const dirName = join(outputDir, `prebid_${tag.replaceAll(/\./g, "_")}`);

    if (existsSync(dirName)) {
      console.log(`${dirName} already installed`);
      successCount++;
    } else {
      console.log(`Building ${tag}...`);
      try {
        await $`cp -R ${workingMasterPath} ${dirName}`;
        await $`git -C ${dirName} checkout ${tag}`.quiet();

        // Modify package.json if globalVarName is specified
        if (globalVarName) {
          const pkgPath = join(dirName, "package.json");
          const pkg = await Bun.file(pkgPath).json();
          pkg.globalVarName = globalVarName;
          await Bun.write(pkgPath, JSON.stringify(pkg, null, 2));
          console.log(`  Set globalVarName to "${globalVarName}"`);
        }

        await $`cd ${dirName} && npm install && npx gulp build`;
        console.log(`${tag} installed`);
        successCount++;
      } catch (error) {
        console.error(`Failed to build ${tag}:`, error instanceof Error ? error.message : error);
        if (existsSync(dirName)) {
          rmSync(dirName, { recursive: true, force: true });
        }
        failCount++;
      }
    }
  }

  if (!keep) {
    rmSync(workingMasterPath, { recursive: true, force: true });
  }

  console.log(`=====> Complete: ${successCount} succeeded, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }

  return { successCount, failCount, tags };
}
