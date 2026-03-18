FROM node:20-slim AS builder

WORKDIR /build

# Copy workspace root files
COPY package.json package-lock.json ./
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/compliance/package.json packages/compliance/package.json

# Install dependencies
RUN npm ci --workspace=packages/dashboard --include-workspace-root

# Copy source
COPY packages/dashboard/ packages/dashboard/
COPY packages/core/ packages/core/

# Build
RUN cd packages/dashboard && npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy built output
COPY --from=builder /build/packages/dashboard/dist ./dist
COPY --from=builder /build/packages/dashboard/node_modules ./node_modules
COPY --from=builder /build/node_modules ./root_modules

# Create data directories
RUN mkdir -p /app/data /app/reports

EXPOSE 5000

# Entrypoint: migrate DB then serve
CMD ["sh", "-c", "node dist/cli.js migrate --db-path ${DASHBOARD_DB_PATH:-/app/data/dashboard.db} 2>/dev/null; node dist/cli.js serve --port ${DASHBOARD_PORT:-5000}"]
