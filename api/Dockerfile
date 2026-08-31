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

# Install only api workspace dependencies
RUN npm ci --workspace=api --ignore-scripts

# Copy source
COPY api/ ./api/

# ── Development stage (hot-reload) ────────────────────────────────────────
FROM base AS dev
WORKDIR /app/api
CMD ["npm", "run", "dev"]

# ── Production build stage ────────────────────────────────────────────────
FROM base AS build
WORKDIR /app/api
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

RUN npm ci --workspace=api --omit=dev --ignore-scripts

# Copy compiled output from build stage
COPY --from=build /app/api/dist ./api/dist

# Run as non-root user
USER node

WORKDIR /app/api
CMD ["node", "dist/index.js"]
