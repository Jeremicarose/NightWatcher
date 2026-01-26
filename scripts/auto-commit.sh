#!/bin/bash

# Auto-commit and push script for NightWatcher
# This script checks for changes and automatically commits and pushes them

# Navigate to the git repository root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📂 Navigating to: $REPO_ROOT"
cd "$REPO_ROOT" || { echo "❌ Failed to navigate to repo root"; exit 1; }

# Verify we're in a git repo
if [ ! -d ".git" ]; then
    echo "❌ Error: Not in a git repository!"
    echo "   Current directory: $(pwd)"
    exit 1
fi

echo "✓ Git repository found at: $(pwd)"

# Check if there are any changes
if [[ -n $(git status -s) ]]; then
    echo "📝 Changes detected. Creating commit..."

    # Get current timestamp
    TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

    # Get changed files summary
    CHANGED_FILES=$(git status -s | wc -l | xargs)

    # Show what will be committed
    echo ""
    echo "Files to commit:"
    git status -s
    echo ""

    # Stage all changes
    git add .

    # Create commit with descriptive message
    git commit -m "🔧 NightWatch update: $TIMESTAMP - Modified $CHANGED_FILES file(s)"

    # Push to GitHub
    echo "🚀 Pushing to GitHub..."
    if git push origin main; then
        echo ""
        echo "✅ Changes committed and pushed successfully!"
        echo "   Time: $TIMESTAMP"
        echo "   Files: $CHANGED_FILES"
    else
        echo "❌ Failed to push to GitHub. Check your connection or credentials."
        exit 1
    fi
else
    echo "✓ No changes to commit."
fi
