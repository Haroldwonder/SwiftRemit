#!/bin/bash

# Webhook System Setup Script

set -e

echo "🔧 Setting up Webhook System..."

# Check if PostgreSQL is running
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed"
    exit 1
fi

# Load environment variables
if [ -f backend/.env ]; then
    source backend/.env
else
    echo "⚠️  No .env file found. Using .env.example"
    cp backend/.env.example backend/.env
fi

# Run database migrations
echo "📊 Running database migrations..."
psql $DATABASE_URL -f backend/migrations/webhook_schema.sql

echo "✅ Database schema created"

# Install dependencies if needed
if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing dependencies..."
    cd backend
    npm install
    cd ..
fi

# Run tests
echo "🧪 Running tests..."
cd backend
npm test -- webhook

echo ""
echo "✅ Webhook system setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Register an anchor in the database"
echo "2. Configure anchor public key or webhook secret"
echo "3. Start the server: npm run dev"
echo "4. Test webhook endpoint: POST /webhooks/anchor"
echo ""
echo "📖 See WEBHOOK_SYSTEM.md for full documentation"
