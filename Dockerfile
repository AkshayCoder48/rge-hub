# Dockerfile for deploying Speed Ramper on Render / Railway / Fly.io
# Includes FFmpeg for video processing capabilities
# Works on ANY platform that supports Docker deployment

# ---- Build Stage ----
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* package-lock.json* yarn.lock* ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner

# Install FFmpeg and FFprobe (the key dependency for video processing)
# Alpine package includes ffmpeg with most commonly needed encoders
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

# Expose port (Render defaults to 10000, but we use 3000 for Next.js)
ENV PORT=3000
EXPOSE 3000

# Start the Next.js standalone server
CMD ["node", "server.js"]
