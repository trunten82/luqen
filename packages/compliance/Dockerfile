# ---- Stage 1: Build ----
FROM node:20-slim AS builder

WORKDIR /build

# Copy root workspace manifests and lock file
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json

# Copy package manifests for both workspaces (npm workspaces requires all)
COPY packages/compliance/package.json ./packages/compliance/package.json
COPY packages/core/package.json ./packages/core/package.json

# Install all dependencies for the compliance workspace
RUN npm install --workspace=packages/compliance

# Copy compliance source
COPY packages/compliance/tsconfig.json ./packages/compliance/tsconfig.json
COPY packages/compliance/src ./packages/compliance/src

# Compile TypeScript
WORKDIR /build/packages/compliance
RUN npx tsc

# Copy seed data alongside compiled output
RUN mkdir -p dist/seed && cp src/seed/baseline.json dist/seed/baseline.json

# ---- Stage 2: Production ----
FROM node:20-slim AS production

WORKDIR /app

# Create directories for persistent data and keys
RUN mkdir -p /app/data /app/keys

# Copy compiled output, node_modules and package.json from builder
COPY --from=builder /build/packages/compliance/dist ./dist
COPY --from=builder /build/packages/compliance/node_modules ./node_modules
COPY --from=builder /build/packages/compliance/package.json ./package.json

# Create entrypoint script that auto-generates keys and seeds DB on first run
RUN printf '#!/bin/sh\n\
set -e\n\
\n\
# Auto-generate JWT keys if not present\n\
if [ ! -f /app/keys/private.pem ] || [ ! -f /app/keys/public.pem ]; then\n\
  echo "Generating JWT key pair..."\n\
  cd /app && node dist/cli.js keys generate\n\
  mv /app/keys/private.pem /app/keys/private.pem 2>/dev/null || true\n\
fi\n\
\n\
# Seed baseline data if DB does not yet exist\n\
if [ ! -f "${COMPLIANCE_DB_PATH:-/app/data/compliance.db}" ]; then\n\
  echo "Seeding baseline compliance data..."\n\
  node dist/cli.js seed\n\
fi\n\
\n\
exec node dist/cli.js serve "$@"\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 4000

ENTRYPOINT ["/app/entrypoint.sh"]
