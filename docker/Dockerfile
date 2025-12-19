# Prebid Bundler Docker Image
#
# This Dockerfile can be used in two ways:
#
# 1. From the prebid-bundler package directory:
#    cd node_modules/prebid-bundler && docker build -f docker/Dockerfile -t my-prebid ..
#    Or: prebid-bundler build --tag my-prebid
#
# 2. After running 'prebid-bundler init' in your project:
#    docker build -t my-prebid .
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
COPY package.json bun.lock* /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production 2>/dev/null || bun install --production

# Build prebid versions
FROM base AS prebid
ARG PREBID_VERSION
ARG PREBID_COUNT=2

# Install git and npm (required for checkout and building Prebid.js)
RUN apt-get update && apt-get install -y --no-install-recommends git npm \
    && rm -rf /var/lib/apt/lists/*

COPY --from=install /temp/prod/node_modules node_modules
COPY package.json bun.lock* ./
COPY src ./src
COPY checkout.ts ./

# Run checkout based on build args
RUN if [ -n "$PREBID_VERSION" ]; then \
        bun checkout.ts --version "$PREBID_VERSION"; \
    else \
        bun checkout.ts --count "$PREBID_COUNT"; \
    fi

# Final image
FROM base AS release

# Install npm for runtime gulp builds (--no-install-recommends keeps it minimal)
RUN apt-get update && apt-get install -y --no-install-recommends npm \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

COPY --from=install /temp/prod/node_modules node_modules
COPY src ./src
COPY package.json .

# Copy prebid versions with ownership set (also creates builds and cache dirs)
COPY --chown=bun:bun --from=prebid /usr/src/app/dist ./dist
RUN mkdir -p ./dist/builds ./dist/cache && chown -R bun:bun ./dist/builds ./dist/cache

ENV PORT=8787
USER bun
EXPOSE 8787/tcp
ENTRYPOINT ["bun", "run", "src/index.ts"]
