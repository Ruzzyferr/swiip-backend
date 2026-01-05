#!/bin/sh
set -e

echo "🚀 Starting Swiip Backend..."

# Extract DB_HOST and DB_PORT from DATABASE_URL if not explicitly set
if [ -z "$DB_HOST" ] && [ -n "$DATABASE_URL" ]; then
  # Parse DATABASE_URL: postgresql://user:pass@host:port/db
  DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
  echo "📋 Parsed from DATABASE_URL - Host: $DB_HOST, Port: $DB_PORT"
fi

# Use defaults if still not set
DB_HOST=${DB_HOST:-postgres}
DB_PORT=${DB_PORT:-5432}

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL at $DB_HOST:$DB_PORT..."
while ! nc -z "$DB_HOST" "$DB_PORT"; do
  sleep 1
done
echo "✅ PostgreSQL is ready!"

# MinIO wait check removed for production compatibility


# Run Prisma migrations
echo "📦 Running database migrations..."
pnpm prisma migrate deploy

# Start the application
echo "🎉 Starting application on port ${PORT:-4000}..."
exec node dist/index.js
