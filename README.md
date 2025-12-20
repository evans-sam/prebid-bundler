# prebid-bundler

A Bun-based service that manages multiple Prebid.js versions and provides an API to build custom Prebid bundles with specified modules.

## Quick Start

### Using as a Package

```bash
# Install the package
bun add prebid-bundler

# Initialize Docker files in your project
bunx prebid-bundler init

# Build a Docker image
docker build -t my-prebid-bundler .
docker run -p 8787:8787 my-prebid-bundler
```

### Local Development

```bash
# Clone and install
git clone <repo-url>
cd prebid-bundler
bun install

# Checkout Prebid.js versions
bun run checkout

# Start the server
bun run dev
```

## CLI Commands

The package provides a `prebid-bundler` CLI with the following commands:

### `prebid-bundler init`

Initialize Docker files in your project for building custom images.

```bash
prebid-bundler init                  # Minimal - references node_modules
prebid-bundler init --full           # Full - standalone, copies all source files
prebid-bundler init --compose        # Include docker-compose.yml
prebid-bundler init -o ./docker      # Output to specific directory
```

### `prebid-bundler build`

Build a Docker image directly.

```bash
prebid-bundler build                                    # Default: 2 recent versions
prebid-bundler build --count 5 --tag my-prebid:v1       # 5 recent versions
prebid-bundler build --versions 10.20.0,9.53.5          # Specific versions
prebid-bundler build --push                             # Push to registry after build
```

### `prebid-bundler checkout`

Clone and build Prebid.js versions locally.

```bash
prebid-bundler checkout                      # 2 most recent versions
prebid-bundler checkout -n 5                 # 5 most recent versions
prebid-bundler checkout -v 10.20.0           # Specific version
prebid-bundler checkout -v 10.20.0 -v 9.0.0  # Multiple versions
prebid-bundler checkout --keep               # Keep working clone for faster runs
```

### `prebid-bundler serve`

Start the HTTP server.

```bash
prebid-bundler serve              # Default port 8787
prebid-bundler serve --port 3000  # Custom port
```

Run `prebid-bundler --help` or `prebid-bundler <command> --help` for full options.

## API Endpoints

### GET /versions

List all available Prebid.js versions.

```bash
curl http://localhost:8787/versions
```

```json
{
  "versions": ["10.20.0", "10.19.0"]
}
```

### GET /modules/:version

List all bundleable modules for a specific version.

```bash
curl http://localhost:8787/modules/10.20.0
```

```json
{
  "version": "10.20.0",
  "modules": ["appnexusBidAdapter", "rubiconBidAdapter", "..."]
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

### GET /health

Health check endpoint.

```bash
curl http://localhost:8787/health
```

## Docker

### Pre-built Images (Recommended)

Pre-built images for each Prebid.js version are automatically published to GitHub Container Registry:

```bash
# Pull the latest version
docker pull ghcr.io/evans-sam/prebid-bundler:latest

# Pull a specific Prebid.js version
docker pull ghcr.io/evans-sam/prebid-bundler:10.20.0

# Pull by major.minor (gets latest patch)
docker pull ghcr.io/evans-sam/prebid-bundler:10.20

# Pull by major (gets latest minor.patch)
docker pull ghcr.io/evans-sam/prebid-bundler:10

# Run
docker run -p 8787:8787 ghcr.io/evans-sam/prebid-bundler:10.20.0
```

### Build from Source

```bash
# Default (2 most recent versions)
docker build -t prebid-bundler .

# Multiple versions
docker build --build-arg PREBID_COUNT=5 -t prebid-bundler .

# Specific version (recommended for production)
docker build --build-arg PREBID_VERSION=10.20.0 -t prebid-bundler:10.20.0 .
```

### Run

```bash
docker run -p 8787:8787 prebid-bundler
```

### Docker Compose

```bash
# After running: prebid-bundler init --compose
docker-compose up --build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | Server port |
| `BUILD_TIMEOUT_MS` | `60000` | Gulp build timeout in milliseconds |

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0.0+
- Git
- Node.js/npm (for building Prebid.js)
- Docker (optional, for containerized builds)

### Scripts

```bash
bun install          # Install dependencies
bun run dev          # Development server with hot reload
bun run start        # Production server
bun run checkout     # Checkout Prebid.js versions
bun test             # Run tests
```

### Project Structure

```
prebid-bundler/
├── bin/cli.ts           # CLI entry point
├── src/
│   ├── index.ts         # HTTP server
│   ├── utils.ts         # Version parsing utilities
│   └── commands/        # CLI command implementations
├── docker/              # Docker templates for init command
├── checkout.ts          # Prebid checkout script
├── Dockerfile           # Main Dockerfile
├── .github/workflows/   # CI/CD workflows
└── package.json
```

## CI/CD

### Automated Image Publishing

The repository includes a GitHub Actions workflow that automatically builds and publishes Docker images for new Prebid.js releases.

**Features:**
- Runs daily at 6 AM UTC to check for new Prebid.js releases
- Only builds images for versions that don't already exist
- Multi-platform builds (linux/amd64, linux/arm64)
- Semantic version tagging (full, major.minor, major, latest)
- Build provenance attestation and SBOM generation
- Manual trigger with options for specific versions or force rebuilds

**Tagging Strategy:**

| Tag | Example | Description |
|-----|---------|-------------|
| Full semver | `10.20.0` | Immutable, specific version |
| Major.minor | `10.20` | Latest patch for this minor |
| Major | `10` | Latest minor.patch for this major |
| `latest` | - | Most recent stable release |

**Manual Trigger:**

You can manually trigger builds from the Actions tab:
- **version**: Build a specific version (e.g., `10.20.0`)
- **count**: Number of recent versions to check (default: 5)
- **force**: Rebuild even if the image already exists

## License

MIT
