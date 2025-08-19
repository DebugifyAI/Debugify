#!/bin/bash

# Production Deployment Script for S3 Upload Pipeline
# This script handles the complete deployment of the enhanced upload pipeline

set -e  # Exit on any error

# Configuration
ENVIRONMENT=${1:-production}
DOCKER_REGISTRY=${DOCKER_REGISTRY:-"your-registry.com"}
IMAGE_TAG=${2:-latest}
COMPOSE_FILE="docker-compose.prod.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Validate environment
validate_environment() {
    log "Validating deployment environment..."
    
    # Check required environment variables
    required_vars=(
        "AWS_ACCESS_KEY_ID"
        "AWS_SECRET_ACCESS_KEY"
        "AWS_REGION"
        "S3_BUCKET_NAME"
        "DATABASE_URL"
        "REDIS_URL"
        "JWT_SECRET"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            error "Required environment variable $var is not set"
        fi
    done
    
    # Check Docker is available
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed or not in PATH"
    fi
    
    # Check Docker Compose is available
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed or not in PATH"
    fi
    
    log "Environment validation passed"
}

# Build and push Docker images
build_and_push_images() {
    log "Building and pushing Docker images..."
    
    # Build server image
    log "Building server image..."
    docker build -t ${DOCKER_REGISTRY}/s3-pipeline-server:${IMAGE_TAG} -f services/server/Dockerfile services/server/
    
    # Build worker image
    log "Building worker image..."
    docker build -t ${DOCKER_REGISTRY}/s3-pipeline-worker:${IMAGE_TAG} -f services/server/Dockerfile.worker services/server/
    
    # Build frontend image
    log "Building frontend image..."
    docker build -t ${DOCKER_REGISTRY}/s3-pipeline-frontend:${IMAGE_TAG} -f services/frontend/Dockerfile services/frontend/
    
    # Push images to registry
    log "Pushing images to registry..."
    docker push ${DOCKER_REGISTRY}/s3-pipeline-server:${IMAGE_TAG}
    docker push ${DOCKER_REGISTRY}/s3-pipeline-worker:${IMAGE_TAG}
    docker push ${DOCKER_REGISTRY}/s3-pipeline-frontend:${IMAGE_TAG}
    
    log "Images built and pushed successfully"
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    
    # Create temporary container to run migrations
    docker run --rm \
        -e DATABASE_URL="${DATABASE_URL}" \
        ${DOCKER_REGISTRY}/s3-pipeline-server:${IMAGE_TAG} \
        npm run migrate
    
    log "Database migrations completed"
}

# Deploy services
deploy_services() {
    log "Deploying services..."
    
    # Export environment variables for docker-compose
    export IMAGE_TAG
    export DOCKER_REGISTRY
    
    # Stop existing services
    log "Stopping existing services..."
    docker-compose -f ${COMPOSE_FILE} down --remove-orphans
    
    # Pull latest images
    log "Pulling latest images..."
    docker-compose -f ${COMPOSE_FILE} pull
    
    # Start services
    log "Starting services..."
    docker-compose -f ${COMPOSE_FILE} up -d
    
    log "Services deployed successfully"
}

# Health check
health_check() {
    log "Performing health checks..."
    
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        log "Health check attempt $attempt/$max_attempts"
        
        # Check server health
        if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
            log "Server health check passed"
            break
        fi
        
        if [[ $attempt -eq $max_attempts ]]; then
            error "Health check failed after $max_attempts attempts"
        fi
        
        sleep 10
        ((attempt++))
    done
    
    # Check worker health (Redis connection)
    log "Checking worker connectivity..."
    docker-compose -f ${COMPOSE_FILE} exec -T worker node -e "
        const Redis = require('ioredis');
        const redis = new Redis(process.env.REDIS_URL);
        redis.ping().then(() => {
            console.log('Worker Redis connection OK');
            process.exit(0);
        }).catch(err => {
            console.error('Worker Redis connection failed:', err);
            process.exit(1);
        });
    "
    
    log "All health checks passed"
}

# Cleanup old images
cleanup() {
    log "Cleaning up old Docker images..."
    
    # Remove dangling images
    docker image prune -f
    
    # Remove old images (keep last 3 versions)
    docker images ${DOCKER_REGISTRY}/s3-pipeline-server --format "table {{.Tag}}\t{{.ID}}" | \
        tail -n +4 | awk '{print $2}' | xargs -r docker rmi
    
    log "Cleanup completed"
}

# Rollback function
rollback() {
    local previous_tag=${1:-"previous"}
    warn "Rolling back to previous version: $previous_tag"
    
    export IMAGE_TAG=$previous_tag
    export DOCKER_REGISTRY
    
    docker-compose -f ${COMPOSE_FILE} down
    docker-compose -f ${COMPOSE_FILE} up -d
    
    log "Rollback completed"
}

# Main deployment flow
main() {
    log "Starting deployment for environment: $ENVIRONMENT"
    
    case "$ENVIRONMENT" in
        "production")
            validate_environment
            build_and_push_images
            run_migrations
            deploy_services
            health_check
            cleanup
            ;;
        "staging")
            validate_environment
            build_and_push_images
            run_migrations
            deploy_services
            health_check
            ;;
        "rollback")
            rollback $2
            ;;
        *)
            error "Unknown environment: $ENVIRONMENT. Use 'production', 'staging', or 'rollback'"
            ;;
    esac
    
    log "Deployment completed successfully!"
}

# Handle script interruption
trap 'error "Deployment interrupted"' INT TERM

# Run main function
main "$@"