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

# Install only frontend workspace dependencies
RUN npm ci --workspace=frontend --ignore-scripts

# Copy source
COPY frontend/ ./frontend/

# ── Development stage (Vite dev server with hot-reload) ───────────────────
FROM base AS dev
WORKDIR /app/frontend
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ── Production build stage ────────────────────────────────────────────────
FROM base AS build
WORKDIR /app/frontend
RUN npm run build

# ── Production runtime stage (nginx) ──────────────────────────────────────
FROM nginx:alpine AS runtime

# Copy built assets from build stage
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Copy nginx configuration if exists
# COPY frontend/nginx.conf /etc/nginx/nginx.conf

# Run as non-root user (nginx runs as nginx user by default in Alpine)
# No need to explicitly set USER as nginx image handles this

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
