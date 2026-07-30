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

WORKDIR /app/api
CMD ["npm", "run", "dev"]
