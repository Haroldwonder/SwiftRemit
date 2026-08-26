# Anchor Selection Dropdown - Issue #166

## Overview

This implementation provides a comprehensive anchor provider selection system that allows users to:
- Select anchor providers from a dropdown
- View detailed fee structures
- View transaction limits
- Review compliance requirements

## Components Created

### Backend API

1. **`api/src/types/anchor.ts`** - TypeScript interfaces for anchor data
2. **`api/src/routes/anchors.ts`** - REST API endpoints for anchor providers
3. **`api/src/app.ts`** - Updated to include anchors route

### Frontend Components

1. **`frontend/src/components/AnchorSelector.tsx`** - Main React component
2. **`frontend/src/components/AnchorSelector.css`** - Styling
3. **`frontend/src/components/__tests__/AnchorSelector.test.tsx`** - Unit tests

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

Returns details for a specific anchor provider.

## Component Usage

```tsx
import { AnchorSelector } from './components/AnchorSelector';

function MyComponent() {
  const handleAnchorSelect = (anchor) => {
    console.log('Selected:', anchor);
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

## Features Implemented

### 1. Anchor Provider Selection
- Dropdown interface with search/filter capability
- Visual indicators for verified providers
- Rating display
- Logo support

### 2. Fee Display
- Deposit fees (percentage + fixed)
- Withdrawal fees (percentage + fixed)
- Minimum and maximum fee caps
- Clear fee calculation display

### 3. Transaction Limits
- Per-transaction limits (min/max)
- Daily transaction limits
- Monthly transaction limits

### 4. Compliance Requirements
- KYC level indicators (Basic, Standard, Enhanced)
- Required documents list
- Supported countries
- Restricted countries with warnings
- Visual badges for compliance levels

## Mock Data

The implementation includes 3 mock anchor providers:
1. MoneyGram Access - Intermediate KYC, global coverage
2. Circle USDC - Enhanced KYC, instant settlement
3. AnchorUSD - Basic KYC, Americas focus

## Testing

Run tests with:
```bash
npm test --prefix frontend
```

## Next Steps

To integrate with production:
1. Replace mock data with database queries
2. Add authentication/authorization
3. Implement real-time anchor status updates
4. Add anchor registration workflow
5. Integrate with smart contract for on-chain verification
