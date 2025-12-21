import { parseArgs } from "node:util";

export async function serve(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      help: { type: "boolean", short: "h" },
      port: { type: "string", short: "p" },
      host: { type: "string", short: "H" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
prebid-bundler serve - Start the Prebid bundler HTTP server

Usage: prebid-bundler serve [options]

Options:
  -h, --help          Show this help message
  -p, --port <port>   Port to listen on (default: 8787, or PORT env var)
  -H, --host <host>   Host to bind to (default: 0.0.0.0)

Environment Variables:
  PORT              Server port (default: 8787)
  BUILD_TIMEOUT_MS  Gulp build timeout in ms (default: 60000)

Examples:
  prebid-bundler serve
  prebid-bundler serve --port 3000
  PORT=8080 prebid-bundler serve
`);
    process.exit(0);
  }

  // Set environment variables from args
  if (values.port) {
    process.env.PORT = values.port;
  }

  if (values.host) {
    process.env.HOST = values.host;
  }

  // Import and run the server
  // This will start the server as the module has top-level execution
  await import("../index.js");
}
