#!/bin/bash

# Property-Based Testing Runner for SwiftRemit Fee Calculations
# This script runs comprehensive fuzzing tests for fee calculation logic

set -e

echo "🧪 Running Property-Based Tests for SwiftRemit Fee Calculations"
echo "=============================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "Cargo.toml" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_status "Running TypeScript property-based tests with fast-check..."
echo ""

# Run TypeScript property tests
cd backend
if npm test -- fee-calculation-property.test.ts; then
    print_success "TypeScript property tests passed!"
else
    print_error "TypeScript property tests failed!"
    exit 1
fi

cd ..

print_status "Running Rust property-based tests with proptest..."
echo ""

# Run Rust property tests
if cargo test fee_service_property_tests --release; then
    print_success "Rust property tests passed!"
else
    print_error "Rust property tests failed!"
    exit 1
fi

print_status "Running additional Rust unit tests..."
echo ""

# Run existing Rust unit tests
if cargo test fee_service::tests --release; then
    print_success "Rust unit tests passed!"
else
    print_error "Rust unit tests failed!"
    exit 1
fi

echo ""
print_success "All property-based tests completed successfully! 🎉"
echo ""
echo "Summary of tests run:"
echo "  ✅ TypeScript fast-check property tests (1000+ test cases)"
echo "  ✅ Rust proptest property tests (1000+ test cases)"
echo "  ✅ Rust unit tests (existing test suite)"
echo ""
echo "These tests verified:"
echo "  • Fee calculations never exceed input amounts"
echo "  • Minimum fee floors are respected"
echo "  • Monotonic behavior with fee rates and amounts"
echo "  • Mathematical consistency in fee breakdowns"
echo "  • Overflow protection for large values"
echo "  • Proper handling of edge cases and boundaries"
echo "  • Dynamic fee tier behavior"
echo "  • Protocol fee calculations"
echo "  • Input validation and error handling"