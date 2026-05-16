#!/bin/sh
set -e

echo "🚀 Starting Conversa Backend..."
echo "📋 DATABASE_URL set: ${DATABASE_URL:+yes}"

# Extract DB_HOST and DB_PORT from DATABASE_URL if not explicitly set
if [ -z "$DB_HOST" ] && [ -n "$DATABASE_URL" ]; then
  # Remove protocol prefix (postgresql://)
  DB_TEMP="${DATABASE_URL#*@}"
  # Extract host (everything before :port or /db)
  DB_HOST="${DB_TEMP%%:*}"
  # If host contains /, extract before /
  DB_HOST="${DB_HOST%%/*}"
  # Extract port (between : and /)
  DB_PORT_TEMP="${DB_TEMP#*:}"
  DB_PORT="${DB_PORT_TEMP%%/*}"
  # Validate port is numeric
  case "$DB_PORT" in
    ''|*[!0-9]*) DB_PORT=5432 ;;
  esac
  echo "📋 Parsed - Host: $DB_HOST, Port: $DB_PORT"
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
