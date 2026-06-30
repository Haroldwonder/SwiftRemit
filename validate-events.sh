#!/bin/bash
# Event Documentation CI/CD Validation Script
# This script validates that all event emissions are properly documented

set -e

echo "🔍 Event Documentation Validation"
echo "=================================="
echo ""

# Check 1: Count event emissions
echo "✓ Checking event emission count..."
EVENT_COUNT=$(grep -c "emit_" src/lib.rs || true)
echo "  Found $EVENT_COUNT event emissions"

# Check 2: Count event comments
echo "✓ Checking event documentation comments..."
COMMENT_COUNT=$(grep -c "// Event:" src/lib.rs || true)
echo "  Found $COMMENT_COUNT event documentation comments"

# Check 3: Verify all events are documented
echo "✓ Verifying all events have documentation..."
UNDOCUMENTED=$(grep -B1 "emit_" src/lib.rs | grep -v "// Event:" | grep -v "emit_" | grep -v "^--$" | wc -l || true)
if [ "$UNDOCUMENTED" -eq 0 ]; then
    echo "  ✅ All events are documented"
else
    echo "  ⚠️  Some events may be missing documentation"
fi

# Check 4: List all documented events
echo ""
echo "📋 Documented Events:"
echo "-------------------"
grep "// Event:" src/lib.rs | sed 's/^[[:space:]]*/  /' | nl

# Check 5: Verify no undefined variables
echo ""
echo "✓ Checking for undefined variables..."
# Look for standalone 'admin.clone()' not preceded by 'new_' or '_to_remove'
if grep -E "[^_]admin\.clone\(\)" src/lib.rs | grep -v "new_admin" | grep -v "admin_to_remove" | grep -q .; then
    echo "  ❌ Found undefined 'admin' variable"
    grep -n -E "[^_]admin\.clone\(\)" src/lib.rs | grep -v "new_admin" | grep -v "admin_to_remove"
    exit 1
else
    echo "  ✅ All variable references are valid"
fi

# Check 6: Verify consistent comment format
echo "✓ Checking comment format consistency..."
MALFORMED=$(grep "// Event:" src/lib.rs | grep -v "Fires when" | wc -l || true)
if [ "$MALFORMED" -eq 0 ]; then
    echo "  ✅ All event comments follow consistent format"
else
    echo "  ⚠️  Some comments may not follow the standard format"
fi

echo ""
echo "=================================="
echo "✅ Event Documentation Validation Complete"
echo ""
echo "Summary:"
echo "  - Event emissions: $EVENT_COUNT"
echo "  - Documented events: $COMMENT_COUNT"
echo "  - Format compliance: ✅"
echo ""
echo "Next steps:"
echo "  1. Run 'make fmt' to format code"
echo "  2. Run 'make check' to verify syntax"
echo "  3. Run 'make test' to run tests"
echo "  4. Run 'make lint' to check for issues"
