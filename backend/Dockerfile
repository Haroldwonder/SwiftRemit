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

# Run migrations then start in dev mode (hot-reload via tsx watch)
WORKDIR /app/backend
CMD ["sh", "-c", "npm run migrate && npm run dev"]
