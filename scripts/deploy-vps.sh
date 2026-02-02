#!/bin/bash
#
# Nightwatch VPS Deployment Script
#
# Usage:
#   1. Create a DigitalOcean droplet (Ubuntu 22.04, $6/month is fine)
#   2. SSH into it: ssh root@YOUR_DROPLET_IP
#   3. Run: curl -fsSL https://raw.githubusercontent.com/Jeremicarose/NightWatcher/main/scripts/deploy-vps.sh | bash
#
# Or manually copy this script and run it.
#

set -e

echo "🌙 Nightwatch VPS Deployment"
echo "============================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (or with sudo)"
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# Install Docker if not present
if ! command -v docker &> /dev/null; then
  echo "🐳 Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
else
  echo "✅ Docker already installed"
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
  echo "📦 Installing Docker Compose..."
  apt-get install -y -qq docker-compose-plugin
fi

# Create app directory
APP_DIR="/opt/nightwatch"
echo "📁 Setting up $APP_DIR..."
mkdir -p $APP_DIR
cd $APP_DIR

# Clone or update repo
if [ -d ".git" ]; then
  echo "🔄 Updating existing installation..."
  git pull origin main
else
  echo "📥 Cloning Nightwatch..."
  git clone https://github.com/Jeremicarose/NightWatcher.git .
fi

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
  echo ""
  echo "⚙️  Creating .env file..."
  echo "   You'll need to add your API keys manually."
  echo ""

  cat > .env << 'EOF'
# Nightwatch Environment Configuration
# Fill in your actual values below

# Gemini API Key (required for log analysis)
GEMINI_API_KEY=your_gemini_api_key_here

# GitHub Personal Access Token (required for creating PRs)
# Needs: repo, workflow permissions
GITHUB_TOKEN=your_github_token_here

# Webhook Secret (optional but recommended)
# Generate with: openssl rand -hex 32
WEBHOOK_SECRET=your_webhook_secret_here

# Server port (default 3000)
PORT=3000
EOF

  echo "📝 Created .env file at $APP_DIR/.env"
  echo "   Edit it with: nano $APP_DIR/.env"
  echo ""
fi

# Build and start
echo "🔨 Building Docker image..."
docker compose build

echo "🚀 Starting Nightwatch..."
docker compose up -d

# Wait for health check
echo "⏳ Waiting for health check..."
sleep 5

if curl -s http://localhost:3000/health | grep -q "ok"; then
  echo ""
  echo "✅ Nightwatch is running!"
  echo ""
  echo "📊 Dashboard: http://$(curl -s ifconfig.me):3000"
  echo "🪝 Webhook:   http://$(curl -s ifconfig.me):3000/webhook"
  echo ""
  echo "Next steps:"
  echo "  1. Edit /opt/nightwatch/.env with your API keys"
  echo "  2. Restart: cd /opt/nightwatch && docker compose restart"
  echo "  3. Set up GitHub App webhook to point to your webhook URL"
  echo ""
else
  echo "❌ Health check failed. Check logs with: docker compose logs"
fi
