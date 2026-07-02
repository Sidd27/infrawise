# Container image for the Docker MCP Catalog (stdio transport).
# Mount your project (with infrawise.yaml) at /project and provide AWS
# credentials via env; serve runs a fresh analysis at boot when no cache exists.
FROM node:24-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY website/package.json ./website/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter infrawise
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24-alpine
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY package.json /app/package.json
WORKDIR /project
ENTRYPOINT ["node", "/app/dist/cli/index.js", "serve", "--stdio"]
