import { join } from "node:path";
import { createServer, type ServerConfig } from "./server.ts";

export * from "./commands/index.ts";
export * from "./server.ts";
// Export utilities for programmatic use
export * from "./utils.ts";

// Only start the server when this file is run directly
if (import.meta.main) {
  const ROOT_DIR = join(import.meta.dir, "..");

  const config: ServerConfig = {
    prebidDir: join(ROOT_DIR, "dist", "prebid.js"),
    buildsDir: join(ROOT_DIR, "dist", "builds"),
    port: parseInt(process.env.PORT || "8787", 10),
    buildTimeoutMs: parseInt(process.env.BUILD_TIMEOUT_MS || "60000", 10),
  };

  const server = createServer(config);

  console.log(`Server running at ${server.url}`);
}
