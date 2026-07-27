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

# Build Next.js (standard build, no standalone)
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner

# Install FFmpeg and FFprobe (the key dependency for video processing)
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy entire built application
COPY --from=builder /app ./

# Create temp directories for video processing
RUN mkdir -p /tmp/speedramper/uploads /tmp/speedramper/processed /tmp/speedramper/tmp

# Expose port
ENV PORT=3000
EXPOSE 3000

# Health check to ensure the server is ready before accepting requests
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the Next.js server (standard mode, not standalone)
CMD ["npm", "start"]
