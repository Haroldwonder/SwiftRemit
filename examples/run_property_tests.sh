#!/bin/bash
# Example script demonstrating how to run property-based tests

set -e

echo "========================================="
echo "SwiftRemit Property-Based Testing Demo"
echo "========================================="
echo ""

echo "1. Quick validation (10 test cases per property)"
echo "   Duration: ~5 seconds"
echo "   Command: PROPTEST_CASES=10 cargo test test_property"
echo ""
read -p "Press Enter to run..."
PROPTEST_CASES=10 cargo test test_property --lib -- --nocapture
echo ""

echo "========================================="
echo "2. Standard testing (50 test cases - default)"
echo "   Duration: ~15 seconds"
echo "   Command: cargo test test_property"
echo ""
read -p "Press Enter to run..."
cargo test test_property --lib
echo ""

echo "========================================="
echo "3. Run specific invariant test"
echo "   Testing: No Balance Creation"
echo "   Command: cargo test prop_no_balance_creation"
echo ""
read -p "Press Enter to run..."
cargo test prop_no_balance_creation --lib
echo ""

echo "========================================="
echo "4. Run with verbose output"
echo "   Command: cargo test prop_fee_calculation_accuracy -- --nocapture"
echo ""
read -p "Press Enter to run..."
cargo test prop_fee_calculation_accuracy --lib -- --nocapture
echo ""

echo "========================================="
echo "All property tests completed successfully!"
echo ""
echo "For more options, see:"
echo "  - PROPERTY_TESTING_QUICKREF.md"
echo "  - PROPERTY_BASED_TESTING.md"
echo "========================================="
