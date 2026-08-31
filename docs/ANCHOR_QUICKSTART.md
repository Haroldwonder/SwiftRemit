# Anchor Selection Dropdown — Integration Guide

> Looking to integrate SwiftRemit into your app (send money end-to-end)? See
> [GETTING_STARTED.md](GETTING_STARTED.md). This page covers the anchor-selection
> dropdown feature specifically.

## Overview

This implementation provides a comprehensive anchor provider selection system (Issue #166) that allows users to:
- Select anchor providers from a dropdown
- View detailed fee structures
- Review transaction limits
- Examine compliance requirements

The feature includes both backend API endpoints and a React frontend component with full SEP-24 anchor integration support.

## What Was Implemented

✅ Backend API for anchor provider data
✅ Frontend React component with dropdown UI
✅ Fee structure display (deposit/withdrawal, percentage + fixed, min/max caps)
✅ Transaction limits display (per-transaction, daily, monthly)
✅ Compliance requirements display (KYC levels, documents, countries)
✅ Filtering by currency and status
✅ Unit tests for both backend and frontend

## File Structure

```
api/
├── src/
│   ├── types/
│   │   └── anchor.ts           # TypeScript interfaces for anchor data
│   ├── routes/
│   │   └── anchors.ts          # REST API endpoints
│   ├── __tests__/
│   │   └── anchors.test.ts     # API tests
│   └── app.ts                  # Updated with anchors route

frontend/
├── src/
│   └── components/
│       ├── AnchorSelector.tsx  # Main React component
│       ├── AnchorSelector.css  # Styling
│       └── __tests__/
│           └── AnchorSelector.test.tsx  # Component tests
```

## API Endpoints

### GET /api/anchors

Returns all available anchor providers with optional filtering.

**Query Parameters:**
- `status` (optional): Filter by status (active, inactive, maintenance)
- `currency` (optional): Filter by supported currency

**Response:**
```json
{
  "success": true,
  "data": [...],
  "count": 3,
  "timestamp": "2026-02-25T10:30:00.000Z"
}
```

### GET /api/anchors/:id

Returns details for a specific anchor provider, including:
- Complete fee structure
- All transaction limits
- Full compliance requirements
- Supported and restricted countries

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

## Component Features

### Dropdown Selection
- Click to open dropdown and view all available anchors
- See ratings and verification status badges
- Quick view of fees, limits, and processing time without expanding

### Detailed View
- Click "Show Details" to expand full information
- Complete fee structure with calculation examples
- All transaction limits
- Full compliance requirements
- Supported countries and restricted country list

### Data Displayed

**Fees:**
- Deposit fee (percentage + fixed amount)
- Withdrawal fee (percentage + fixed amount)
- Min/max fee caps

**Limits:**
- Per-transaction limits (min/max)
- Daily limits
- Monthly limits

**Compliance:**
- KYC level (Basic/Standard/Enhanced)
- Required documents list
- Supported countries
- Restricted countries with warnings

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

The component uses CSS modules for styling and theming. Customize by editing:
- `frontend/src/components/AnchorSelector.css`

## Mock Data

Currently includes 3 anchor providers for development:

1. **MoneyGram Access** — Global coverage, intermediate KYC
2. **Circle USDC** — Instant settlement, enhanced KYC
3. **AnchorUSD** — Americas focus, basic KYC

## Testing

```bash
# Backend tests
cd api
npm test

# Frontend tests
cd frontend
npm test
```

## Production Roadmap

### Database Integration
- Replace mock data with database queries
- Add anchor CRUD operations
- Implement caching strategy

### Authentication & Rate Limiting
- Add API authentication
- Implement rate limiting per user
- Add admin endpoints for anchor management

### Real-time Updates
- WebSocket for anchor status changes
- Live fee updates
- Availability notifications

### Smart Contract Integration
- Store anchor verification on-chain
- Integrate with remittance contract
- Add settlement tracking

## Support

For issues or questions:
- Check `api/README.md` for full API documentation
- Review component source code with inline comments
- See `GETTING_STARTED.md` for SEP-24 anchor integration context
