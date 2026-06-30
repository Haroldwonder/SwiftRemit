# Anchor Selection Dropdown - Quick Start Guide

## Issue #166 Implementation

This guide will help you get the anchor selection feature up and running.

## What Was Implemented

✅ Backend API for anchor provider data
✅ Frontend React component with dropdown UI
✅ Fee structure display
✅ Transaction limits display
✅ Compliance requirements display
✅ Filtering by currency and status
✅ Unit tests for both backend and frontend

## File Structure

```
api/
├── src/
│   ├── routes/
│   │   └── anchors.ts          # Anchor API endpoints
│   ├── types/
│   │   └── anchor.ts           # TypeScript interfaces
│   ├── __tests__/
│   │   └── anchors.test.ts     # API tests
│   └── app.ts                  # Updated with anchors route

frontend/
├── src/
│   └── components/
│       ├── AnchorSelector.tsx  # Main component
│       ├── AnchorSelector.css  # Styling
│       └── __tests__/
│           └── AnchorSelector.test.tsx  # Component tests
```

## Quick Start

### 1. Start the Backend API

```bash
cd api
npm install
npm run dev
```

The API will be available at `http://localhost:3000`

### 2. Test the API

```bash
# Get all anchors
curl http://localhost:3000/api/anchors

# Get anchors for USD
curl http://localhost:3000/api/anchors?currency=USD

# Get specific anchor
curl http://localhost:3000/api/anchors/anchor-1
```

### 3. Use the Frontend Component

```tsx
import { AnchorSelector } from './components/AnchorSelector';

function RemittanceForm() {
  const handleAnchorSelect = (anchor) => {
    console.log('Selected anchor:', anchor);
    // Use anchor data for your remittance
  };

  return (
    <AnchorSelector
      onSelect={handleAnchorSelect}
      currency="USD"
      apiUrl="http://localhost:3000"
    />
  );
}
```

## Features

### Dropdown Selection
- Click to open dropdown
- View all available anchors
- See ratings and verification status
- Quick view of fees, limits, and processing time

### Detailed View
- Click "Show Details" to expand
- Complete fee structure
- All transaction limits
- Full compliance requirements
- Supported countries and restrictions

### Data Displayed

**Fees:**
- Deposit fee (% + fixed)
- Withdrawal fee (% + fixed)
- Min/max fee caps

**Limits:**
- Per transaction (min/max)
- Daily limits
- Monthly limits

**Compliance:**
- KYC level (Basic/Standard/Enhanced)
- Required documents
- Supported countries
- Restricted countries

## Mock Data

Currently includes 3 anchor providers:

1. **MoneyGram Access** - Global coverage, intermediate KYC
2. **Circle USDC** - Instant settlement, enhanced KYC
3. **AnchorUSD** - Americas focus, basic KYC

## Next Steps

### For Production

1. **Database Integration**
   - Replace mock data with database queries
   - Add anchor CRUD operations
   - Implement caching

2. **Authentication**
   - Add API authentication
   - Implement rate limiting per user
   - Add admin endpoints

3. **Real-time Updates**
   - WebSocket for status changes
   - Live fee updates
   - Availability notifications

4. **Smart Contract Integration**
   - Store anchor verification on-chain
   - Integrate with remittance contract
   - Add settlement tracking

## Testing

```bash
# Backend tests
cd api
npm test

# Frontend tests
cd frontend
npm test
```

## API Documentation

Full API documentation is available in `api/README.md`

## Component Props

```typescript
interface AnchorSelectorProps {
  onSelect: (anchor: AnchorProvider) => void;
  selectedAnchorId?: string;
  currency?: string;
  apiUrl?: string;
}
```

## Styling

The component uses CSS modules. Customize by editing:
- `frontend/src/components/AnchorSelector.css`

## Support

For issues or questions, refer to:
- `ANCHOR_SELECTION.md` - Full implementation details
- `api/README.md` - API documentation
- Component source code with inline comments
