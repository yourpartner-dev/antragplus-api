# Stage 1: Build Stage
FROM node:22.16.0-bullseye-slim AS builder

ENV NODE_OPTIONS=--max-old-space-size=8192
# Set working directory
WORKDIR /app

# Install build tools and timezone data
RUN apt-get update && \
    apt-get install -y python3 build-essential tzdata && \
    ln -sf /usr/bin/python3 /usr/bin/python && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Enable Corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install all dependencies (including devDependencies) and --frozen-lockfile removed
RUN pnpm install 

# Install TypeScript globally
RUN npm install -g typescript

# Copy the rest of the application code
COPY . .

# Build the project
RUN pnpm run build

# Prune devDependencies to keep node_modules lean for production
RUN CI=true pnpm prune --prod

# Stage 2: Production Stage
FROM node:22.16.0-bullseye-slim AS runtime

# Set timezone environment variable
ENV TZ=Europe/Berlin

# Set working directory
WORKDIR /app

# Install tzdata package
RUN apt-get update && \
    apt-get install -y tzdata && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Enable Corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy pruned node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy built files from the builder stage
COPY --from=builder /app/dist ./dist

# Copy storage service account key
COPY antragplus-472111-309366383e4e.json ./antragplus-472111-309366383e4e.json

# Ensure the 'uploads' directory exists
RUN mkdir -p /app/uploads

# Create a non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app
USER app

# Expose the application port
EXPOSE 8055

# Start the application directly (bootstrap should be run separately via Cloud Run job or init container)
# Note: Run `node dist/cli/run.js bootstrap` as a one-time Cloud Run job before first deployment
CMD ["node", "dist/start.js"]