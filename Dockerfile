FROM node:20-slim

# Install Python, ffmpeg, and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages globally
RUN pip3 install --break-system-packages gdown anthropic httpx

WORKDIR /app

# Copy package files and install Node dependencies
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Expose port
EXPOSE 5000

# Start production server
ENV NODE_ENV=production
CMD ["node", "dist/index.cjs"]
