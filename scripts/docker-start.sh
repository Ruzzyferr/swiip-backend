#!/bin/sh
set -e

echo "🚀 Starting Swiip Backend..."

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL..."
while ! nc -z ${DB_HOST:-postgres} ${DB_PORT:-5432}; do
  sleep 1
done
echo "✅ PostgreSQL is ready!"

# Wait for MinIO to be ready (optional, only if S3_ENDPOINT is set)
if [ -n "$S3_ENDPOINT" ]; then
  MINIO_HOST=$(echo $S3_ENDPOINT | sed -e 's|http[s]*://||' -e 's|:.*||')
  MINIO_PORT=$(echo $S3_ENDPOINT | sed -e 's|.*:||' -e 's|/.*||')
  echo "⏳ Waiting for MinIO at ${MINIO_HOST}:${MINIO_PORT}..."
  while ! nc -z ${MINIO_HOST} ${MINIO_PORT:-9000}; do
    sleep 1
  done
  echo "✅ MinIO is ready!"
fi

# Run Prisma migrations
echo "📦 Running database migrations..."
npx prisma migrate deploy

# Start the application
echo "🎉 Starting application on port ${PORT:-4000}..."
exec node dist/index.js
