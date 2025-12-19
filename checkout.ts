import {$} from "bun";
import {existsSync, mkdirSync, rmSync} from "node:fs";
import {join, resolve} from "node:path";
import {parseArgs} from "util";

// Parse command line arguments
const {values, positionals} = parseArgs({
    args: Bun.argv.slice(2),
    options: {
        version: {type: "string", short: "v", multiple: true},
        count: {type: "string", short: "n"},
        keep: {type: "boolean", short: "k"},
        help: {type: "boolean", short: "h"},
    },
    allowPositionals: true,
});

if (values.help) {
    console.log(`Usage: bun checkout.ts [options]

Options:
  -v, --version <tag>   Checkout a specific version (can be repeated)
  -n, --count <num>     Checkout the N most recent versions (default: 2)
  -k, --keep            Keep the working master clone for faster subsequent runs
  -h, --help            Show this help message

Examples:
  bun checkout.ts                      # Checkout 2 most recent versions
  bun checkout.ts -n 5                 # Checkout 5 most recent versions
  bun checkout.ts -v 10.20.0           # Checkout specific version
  bun checkout.ts -v 10.20.0 -v 9.0.0  # Checkout multiple specific versions
  bun checkout.ts 3                    # Legacy: checkout 3 most recent versions
`);
    process.exit(0);
}

const PREBID_DIR = resolve("dist/prebid.js");
const keepWorkingMaster = values.keep || process.env.KEEP_WORKING_MASTER === "true";

if (!existsSync(PREBID_DIR)) {
    mkdirSync(PREBID_DIR, {recursive: true});
}

const workingMasterPath = join(PREBID_DIR, "working_master");

if (!existsSync(workingMasterPath)) {
    console.log("=====> Cloning Prebid.js repository...");
    await $`git clone https://github.com/prebid/Prebid.js.git ${workingMasterPath}`;
}

await $`git -C ${workingMasterPath} fetch --tags`;

// Determine which tags to checkout
let tags: string[];

if (values.version && values.version.length > 0) {
    // Specific versions requested
    tags = values.version;
    console.log(`=====> Checking out ${tags.length} specific version(s): ${tags.join(", ")}`);
} else {
    // Get N most recent versions
    const count = parseInt(values.count ?? "") || parseInt(positionals[0] ?? "") || parseInt(process.env.NUMBER_OF_PREVIOUS_VERSIONS || "") || 2;
    const tagsOutput = await $`git -C ${workingMasterPath} tag --sort=-creatordate`.text();
    tags = tagsOutput.trim().split("\n").slice(0, count);
    console.log(`=====> Checking out ${count} most recent version(s)`);
}

let successCount = 0;
let failCount = 0;

for (const tag of tags) {
    const dirName = join(PREBID_DIR, `prebid_${tag.replaceAll(/\./g, "_")}`);

    if (existsSync(dirName)) {
        console.log(`${dirName} already installed`);
        successCount++;
    } else {
        console.log(`Building ${tag}...`);
        try {
            await $`cp -R ${workingMasterPath} ${dirName}`;
            await $`git -C ${dirName} checkout ${tag}`.quiet();
            await $`cd ${dirName} && npm install && npx gulp build`;
            console.log(`${tag} installed`);
            successCount++;
        } catch (error) {
            console.error(`Failed to build ${tag}:`, error instanceof Error ? error.message : error);
            if (existsSync(dirName)) {
                rmSync(dirName, {recursive: true, force: true});
            }
            failCount++;
        }
    }
}

if (!keepWorkingMaster) {
    rmSync(workingMasterPath, {recursive: true, force: true});
}

console.log(`=====> Complete: ${successCount} succeeded, ${failCount} failed`);

if (failCount > 0) {
    process.exit(1);
}
