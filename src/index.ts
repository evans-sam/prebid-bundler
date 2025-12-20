import {join} from "node:path";
import {createServer, type ServerConfig} from "./server.ts";

// Export utilities for programmatic use
export * from "./utils.ts";
export * from "./commands/index.ts";
export * from "./server.ts";

const ROOT_DIR = join(import.meta.dir, "..");

const config: ServerConfig = {
    prebidDir: join(ROOT_DIR, "dist", "prebid.js"),
    buildsDir: join(ROOT_DIR, "dist", "builds"),
    port: parseInt(process.env.PORT || "8787"),
    buildTimeoutMs: parseInt(process.env.BUILD_TIMEOUT_MS || "60000"),
};

const server = createServer(config);

console.log(`Server running at ${server.url}`);

export {server};
