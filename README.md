# prebid-bundler

A Bun-based service that manages multiple Prebid.js versions and exposes an API to list available bidder modules.

## Prerequisites

- [Bun](https://bun.sh) v1.3.5+
- Git
- Node.js (for building Prebid.js versions)

## Installation

```bash
bun install
```

## Usage

### 1. Checkout Prebid.js Versions (optional for local development)

Download and build Prebid.js releases locally:

```bash
# Checkout the 2 most recent versions (default)
bun run checkout

# Checkout N most recent versions
bun run checkout -- -n 5

# Checkout a specific version
bun run checkout -- -v 10.20.0

# Checkout multiple specific versions
bun run checkout -- -v 10.20.0 -v 9.0.0

# Keep working clone for faster subsequent runs
bun run checkout -- -n 3 --keep
```

Run `bun run checkout -- --help` for all options.

### 2. Start the Server

```bash
# Development mode with hot reload
bun run dev

# Production mode
bun run start
```

The server runs on port 8787 by default. Set `PORT` environment variable to change.

## API Endpoints

### GET /versions

List all available Prebid.js versions.

```bash
curl http://localhost:8787/versions
```

Response:
```json
{
  "versions": ["10.20.0", "10.19.0"]
}
```

### GET /modules/:version

List all modules for a specific version.

```bash
curl http://localhost:8787/modules/10.20.0
```

Response:
```json
{
  "version": "10.20.0",
  "modules": ["appnexusBidAdapter", "rubiconBidAdapter", ...]
}
```

### POST /bundle/:version

Build a custom Prebid.js bundle with specified modules. Returns the bundled JavaScript file.

```bash
curl -X POST http://localhost:8787/bundle/10.20.0 \
  -H "Content-Type: application/json" \
  -d '{"modules": ["appnexusBidAdapter", "rubiconBidAdapter"]}' \
  -o prebid.js
```

Request body:
```json
{
  "modules": ["appnexusBidAdapter", "rubiconBidAdapter", "consentManagement"]
}
```

Response: JavaScript file stream (`application/javascript`)

### GET /health

Health check endpoint.

```bash
curl http://localhost:8787/health
```

## Testing

```bash
bun test
```

## Docker

The Docker build automatically checks out and builds Prebid.js versions.

### Default (2 most recent versions)

```bash
docker build -t prebid-bundler .
docker run -p 8787:8787 prebid-bundler
```

### Multiple versions

```bash
docker build --build-arg PREBID_COUNT=5 -t prebid-bundler .
```

### Single version (recommended for production)

```bash
docker build --build-arg PREBID_VERSION=10.20.0 -t prebid-bundler:10.20.0 .
docker run -p 8787:8787 prebid-bundler:10.20.0
```
