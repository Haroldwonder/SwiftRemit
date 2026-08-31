FROM node:20-alpine AS base
WORKDIR /app

# Copy workspace manifests and root lockfile for workspace-aware install
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY sdk/package.json ./sdk/
COPY sdk/react-native/package.json ./sdk/react-native/
COPY api/package.json ./api/
COPY frontend/package.json ./frontend/
COPY mobile/package.json ./mobile/
COPY examples/package.json ./examples/

# Install only backend + sdk workspace dependencies
RUN npm ci --workspace=backend --workspace=sdk --ignore-scripts

# Copy workspace source files
COPY backend/ ./backend/
COPY sdk/ ./sdk/

# Build the SDK first (backend depends on it)
RUN npm run build --workspace=sdk

# ── Development stage (hot-reload) ────────────────────────────────────────
FROM base AS dev
WORKDIR /app/backend
CMD ["sh", "-c", "npm run migrate && npm run dev"]

# ── Production build stage ────────────────────────────────────────────────
FROM base AS build
WORKDIR /app/backend
RUN npm run build

# ── Production runtime stage ──────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy workspace manifests and install production dependencies only
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY sdk/package.json ./sdk/
COPY sdk/react-native/package.json ./sdk/react-native/
COPY api/package.json ./api/
COPY frontend/package.json ./frontend/
COPY mobile/package.json ./mobile/
COPY examples/package.json ./examples/

RUN npm ci --workspace=backend --workspace=sdk --omit=dev --ignore-scripts

# Copy compiled output from build stage
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/sdk/dist ./sdk/dist
COPY backend/migrations ./backend/migrations

# Run as non-root user
USER node

WORKDIR /app/backend
CMD ["sh", "-c", "npm run migrate && node dist/index.js"]
