#!/bin/bash

# Webhook System Verification Script
# Verifies all components are properly installed and working

set -e

echo "🔍 Webhook System Verification"
echo "================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track results
PASSED=0
FAILED=0

check_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASSED++))
}

check_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
}

# 1. Check files exist
echo "📁 Checking files..."
FILES=(
    "backend/src/webhook-verifier.ts"
    "backend/src/webhook-logger.ts"
    "backend/src/webhook-handler.ts"
    "backend/src/webhook-health.ts"
    "backend/src/transaction-state.ts"
    "backend/src/__tests__/webhook-verifier.test.ts"
    "backend/src/__tests__/transaction-state.test.ts"
    "backend/migrations/webhook_schema.sql"
    ".github/workflows/webhook-ci.yml"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        check_pass "File exists: $file"
    else
        check_fail "File missing: $file"
    fi
done
echo ""

# 2. Check dependencies
echo "📦 Checking dependencies..."
cd backend

if [ -d "node_modules" ]; then
    check_pass "node_modules installed"
else
    check_fail "node_modules not found - run: npm install"
fi

# Check key dependencies
DEPS=("@stellar/stellar-sdk" "express" "pg" "vitest" "typescript")
for dep in "${DEPS[@]}"; do
    if [ -d "node_modules/$dep" ]; then
        check_pass "Dependency installed: $dep"
    else
        check_fail "Dependency missing: $dep"
    fi
done
echo ""

# 3. TypeScript compilation
echo "🔨 Checking TypeScript compilation..."
if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
    check_fail "TypeScript compilation has errors"
else
    check_pass "TypeScript compilation successful"
fi
echo ""

# 4. Run tests
echo "🧪 Running webhook tests..."
if npm test -- webhook-verifier --run 2>&1 | grep -q "PASS"; then
    check_pass "Webhook verifier tests passing"
else
    check_fail "Webhook verifier tests failing"
fi

if npm test -- transaction-state --run 2>&1 | grep -q "PASS"; then
    check_pass "Transaction state tests passing"
else
    check_fail "Transaction state tests failing"
fi
echo ""

# 5. Build verification
echo "🏗️  Checking production build..."
if npm run build 2>&1; then
    if [ -f "dist/webhook-handler.js" ]; then
        check_pass "Production build successful"
    else
        check_fail "Build files not generated"
    fi
else
    check_fail "Production build failed"
fi
echo ""

# 6. Check documentation
echo "📖 Checking documentation..."
cd ..
DOCS=(
    "WEBHOOK_SYSTEM.md"
    "WEBHOOK_IMPLEMENTATION_SUMMARY.md"
    "WEBHOOK_QUICK_REFERENCE.md"
    "WEBHOOK_TEST_REPORT.md"
    "WEBHOOK_COMPLETE.md"
)

for doc in "${DOCS[@]}"; do
    if [ -f "$doc" ]; then
        check_pass "Documentation exists: $doc"
    else
        check_fail "Documentation missing: $doc"
    fi
done
echo ""

# 7. Check CI/CD
echo "🔄 Checking CI/CD configuration..."
if [ -f ".github/workflows/webhook-ci.yml" ]; then
    check_pass "CI/CD workflow configured"
    
    # Check workflow has required jobs
    if grep -q "test:" ".github/workflows/webhook-ci.yml"; then
        check_pass "Test job configured"
    else
        check_fail "Test job missing"
    fi
    
    if grep -q "security:" ".github/workflows/webhook-ci.yml"; then
        check_pass "Security job configured"
    else
        check_fail "Security job missing"
    fi
else
    check_fail "CI/CD workflow missing"
fi
echo ""

# Summary
echo "================================"
echo "📊 Verification Summary"
echo "================================"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! Webhook system is ready.${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Setup database: ./setup-webhooks.sh"
    echo "2. Start server: cd backend && npm run dev"
    echo "3. Test webhook: npm run webhook:example"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please review the errors above.${NC}"
    exit 1
fi
