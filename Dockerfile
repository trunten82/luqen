# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/core/package*.json packages/core/
COPY packages/compliance/package*.json packages/compliance/
COPY packages/dashboard/package*.json packages/dashboard/
COPY packages/monitor/package*.json packages/monitor/
RUN npm install --ignore-scripts
COPY . .
RUN npm run build --workspaces

# Stage 2: Runtime
FROM node:20-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./
COPY --from=builder /app/start.sh ./

# Create data directories
RUN mkdir -p /app/data /app/plugins /app/reports

EXPOSE 4000 5000
