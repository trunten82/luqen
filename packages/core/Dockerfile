# ---- Stage 1: Build ----
FROM node:20-slim AS builder

WORKDIR /build

# Copy root workspace manifests and lock file
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json

# Copy package manifests for both workspaces (npm workspaces requires all)
COPY packages/core/package.json ./packages/core/package.json
COPY packages/compliance/package.json ./packages/compliance/package.json

# Install all dependencies for the core workspace
RUN npm install --workspace=packages/core

# Copy core source
COPY packages/core/tsconfig.json ./packages/core/tsconfig.json
COPY packages/core/src ./packages/core/src

# Compile TypeScript
WORKDIR /build/packages/core
RUN npx tsc

# Copy Handlebars template alongside compiled output
RUN mkdir -p dist/reporter && cp src/reporter/report.hbs dist/reporter/report.hbs

# ---- Stage 2: Production ----
FROM node:20-slim AS production

WORKDIR /app

# Copy compiled output, node_modules and package.json from builder
COPY --from=builder /build/packages/core/dist ./dist
COPY --from=builder /build/packages/core/node_modules ./node_modules
COPY --from=builder /build/packages/core/package.json ./package.json

# Default output directory for reports
RUN mkdir -p /app/reports

ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
