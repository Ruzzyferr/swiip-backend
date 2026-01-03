#!/bin/sh
set -e

echo "🚀 Starting Swiip Backend..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
while ! nc -z ${DB_HOST:-postgres} ${DB_PORT:-5432}; do
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
