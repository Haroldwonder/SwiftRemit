FROM node:20-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Run migrations then start in dev mode (hot-reload via tsx watch)
CMD ["sh", "-c", "pnpm run migrate && pnpm run dev"]
