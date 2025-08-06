#!/bin/bash

# Docker Compose Build Script
# This script builds and runs Docker containers with logging

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

print_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Main script
print_status "Starting Docker Compose build process..."

# Build containers with no cache and log output
print_status "Building containers (no cache)..."
if docker compose build --progress=plain --no-cache 2>&1 | tee build-debug.log; then
    print_status "Build completed successfully!"
    print_status "Build log saved to: build-debug.log"
    
    # Start containers in detached mode
    print_status "Starting containers in detached mode..."
    if docker compose up -d; then
        print_status "Containers started successfully!"
        
        # Show running containers
        print_status "Running containers:"
        docker compose ps
    else
        print_error "Failed to start containers!"
        exit 1
    fi
else
    print_error "Build failed! Check build-debug.log for details."
    exit 1
fi

print_status "Docker Compose deployment complete!"