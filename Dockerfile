# Container image for the Docker MCP Catalog (stdio transport).
# Mount your project (with infrawise.yaml) at /project and provide AWS
# credentials via env; serve runs a fresh analysis at boot when no cache exists.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node 26 no longer bundles corepack. Installing it from npm keeps the pnpm
# version driven by package.json's packageManager field instead of pinning it
# a second time here.
RUN npm i -g corepack && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY website/package.json ./website/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter infrawise
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod --ignore-scripts

# Same major as the build stage, so node_modules is never installed under one
# runtime and executed under another. Node 26 becomes LTS on 2026-10-28. tsc
# emits per tsconfig target, so this never narrows what the package supports:
# engines stays >=22.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66
ENV NODE_ENV=production
# The entrypoint runs `node` only. npm and corepack ship with the official image
# and are the sole source of its CVEs (their vendored tar, undici and
# brace-expansion), so drop them from the runtime stage. Bumping the base major
# does not clear them on its own: 24 and 26 ship the same vulnerable set.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY package.json /app/package.json
WORKDIR /project
ENTRYPOINT ["node", "/app/dist/cli/index.js", "serve", "--stdio"]
