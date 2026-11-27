FROM node:22-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY extensions/browser/package.json extensions/browser/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages/protocol packages/protocol
COPY packages/server packages/server
RUN npm run build -w agent-browser-bridge-mcp

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY extensions/browser/package.json extensions/browser/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w agent-browser-bridge-mcp && npm cache clean --force
COPY --from=build /src/packages/server/dist packages/server/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "packages/server/dist/index.js", "http"]
