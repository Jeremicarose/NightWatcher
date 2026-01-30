# Nightwatch - Self-healing CI/CD Agent
FROM node:20-slim

# Install build tools for native modules, git, and Docker CLI
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    && curl -fsSL https://get.docker.com | sh \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
