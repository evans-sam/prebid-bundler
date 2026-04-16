# Prebid Bundler Docker Image
#
# Build with 2 most recent versions (default):
#   docker build -t prebid-bundler .
#
# Build with N most recent versions:
#   docker build --build-arg PREBID_COUNT=5 -t prebid-bundler .
#
# Build with specific version:
#   docker build --build-arg PREBID_VERSION=10.20.0 -t prebid-bundler:10.20.0 .
#
# Build with custom global variable name:
#   docker build --build-arg PREBID_GLOBAL_VAR_NAME=myPrebid -t prebid-bundler .

FROM oven/bun:1@sha256:8956c7667fa17beb6e3c664115e66bdacfe502da5d99603626e74c197bdef160 AS base
WORKDIR /usr/src/app

# Install dependencies into temp directory for caching
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Build prebid versions
# PREBID_VERSION: specific version tag (e.g., 10.20.0)
# PREBID_COUNT: number of recent versions to checkout (default: 2)
FROM base AS prebid

# Install git and npm BEFORE ARGs to maximize layer caching
# These layers are identical across all Prebid versions
RUN apt-get update && apt-get install -y --no-install-recommends git npm \
    && rm -rf /var/lib/apt/lists/*

COPY --from=install /temp/prod/node_modules node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY checkout.ts .

# ARGs declared after cacheable layers - changing version won't invalidate apt/npm cache
ARG PREBID_VERSION
ARG PREBID_COUNT=2
ARG PREBID_GLOBAL_VAR_NAME

# Run checkout - ownership is set via COPY --chown in release stage
RUN GLOBAL_ARG=""; \
    if [ -n "$PREBID_GLOBAL_VAR_NAME" ]; then \
        GLOBAL_ARG="--global-var-name $PREBID_GLOBAL_VAR_NAME"; \
    fi; \
    if [ -n "$PREBID_VERSION" ]; then \
        bun checkout.ts --version "$PREBID_VERSION" $GLOBAL_ARG; \
    else \
        bun checkout.ts --count "$PREBID_COUNT" $GLOBAL_ARG; \
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

# Copy prebid versions with ownership set (also creates builds dir)
COPY --chown=bun:bun --from=prebid /usr/src/app/dist ./dist
RUN mkdir -p ./dist/builds && chown bun:bun ./dist/builds

ENV PORT=8787
USER bun
EXPOSE 8787/tcp
ENTRYPOINT ["bun", "run", "src/index.ts"]
