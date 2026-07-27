# Dockerfile for deploying Speed Ramper on Render / Railway / Fly.io
# Includes FFmpeg for video processing capabilities
# Works on ANY platform that supports Docker deployment

# ---- Build Stage ----
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb* package-lock.json* yarn.lock* ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (with standalone output for smaller production image)
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner

# Install FFmpeg and FFprobe (the key dependency for video processing)
# Alpine package includes ffmpeg with most commonly needed encoders including libx264, libx265
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built application from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# Generate Prisma client in production
RUN npx prisma generate

# Create temp directories for video processing
RUN mkdir -p /tmp/speedramper/uploads /tmp/speedramper/processed /tmp/speedramper/tmp

# The standalone build creates a server.js that can run without the full Next.js runtime
# This is significantly smaller and faster than running next start
ENV PORT=3000
EXPOSE 3000

# Health check to ensure the server is ready before accepting requests
# This prevents the "function is pending state" deployment errors
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the Next.js standalone server
CMD ["node", "server.js"]
