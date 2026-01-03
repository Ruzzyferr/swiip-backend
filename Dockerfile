# -------------------
# Build Stage
# -------------------
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy prisma schema first
COPY prisma ./prisma

# Generate Prisma client
RUN pnpm prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build

# -------------------
# Production Stage
# -------------------
FROM node:22-alpine AS production

# Install pnpm and netcat for health checks
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate && \
  apk add --no-cache netcat-openbsd

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy Prisma schema
COPY --from=builder /app/prisma ./prisma

# Generate Prisma client in production stage
RUN pnpm prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy startup script
COPY scripts/docker-start.sh ./scripts/docker-start.sh
RUN chmod +x ./scripts/docker-start.sh

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start application
CMD ["./scripts/docker-start.sh"]
