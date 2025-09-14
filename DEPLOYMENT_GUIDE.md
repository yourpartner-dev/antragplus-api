# Google Cloud Run Deployment Guide

## Prerequisites
- Google Cloud CLI installed (`brew install google-cloud-sdk`)
- Docker installed
- Authenticated with Google Cloud (`gcloud auth login`)
- Project set (`gcloud config set project YOUR_PROJECT_ID`)

## One-Time Setup

### 1. Enable Required APIs
```bash
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable artifactregistry.googleapis.com
```

### 2. Create Artifact Registry Repository (Germany/Frankfurt)
```bash
gcloud artifacts repositories create antragplus-api \
  --repository-format=docker \
  --location=europe-west3 \
  --description="Docker repository for antragplus-api"
```

### 3. Configure Docker Authentication
```bash
gcloud auth configure-docker europe-west3-docker.pkg.dev
```

## Manual Deployment Steps (Every Release)

### 1. Fix Dockerfile pnpm issue
Edit line 34 in Dockerfile:
```dockerfile
# FROM:
RUN pnpm prune --prod

# TO:
RUN CI=true pnpm prune --prod
```

### 2. Update docker-compose.yml with your project ID
Replace `YOUR_PROJECT_ID` in docker-compose.yml with your actual Google Cloud project ID.

### 3. Build and Push Multi-Platform Image
```bash
# Enable buildx for multi-platform builds (one-time setup)
docker buildx create --use

# Build and push in one command (like your Azure approach)
docker buildx build --platform linux/amd64,linux/arm64 \
  -t europe-west3-docker.pkg.dev/antragplus-472111/antragplus/api:1.0.0 \
  --push .
```

### 4. Deploy to Cloud Run with Environment Variables
```bash
 gcloud run deploy antragplus-api \
    --image europe-west3-docker.pkg.dev/antragplus-472111/antragplus/api:1.0.1 \
    --region europe-west3 \
    --allow-unauthenticated \
    --port 8055 \
    --memory 4Gi \
    --cpu 4 \
    --env-vars-file .env.cloudrun.yaml \
    --network default \
    --subnet default \
    --vpc-egress private-ranges-only
```

### 6. Update Environment Variables (if needed)
```bash
gcloud run services update antragplus-api \
  --region europe-west3 \
  --set-env-vars="NODE_ENV=production,PORT=8055,DATABASE_URL=your_database_url"
```

## Quick Deploy Script
Create a `deploy.sh` script:
```bash
#!/bin/bash
PROJECT_ID="YOUR_PROJECT_ID"
IMAGE_NAME="antragplus-api"
REGION="europe-west3"

# Build and push
docker build -t $IMAGE_NAME .
docker tag $IMAGE_NAME $REGION-docker.pkg.dev/$PROJECT_ID/$IMAGE_NAME/$IMAGE_NAME:latest
docker push $REGION-docker.pkg.dev/$PROJECT_ID/$IMAGE_NAME/$IMAGE_NAME:latest

# Deploy
gcloud run deploy $IMAGE_NAME \
  --image $REGION-docker.pkg.dev/$PROJECT_ID/$IMAGE_NAME/$IMAGE_NAME:latest \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8055 \
  --memory 2Gi \
  --cpu 2
```

## Notes
- Replace `YOUR_PROJECT_ID` with your actual Google Cloud project ID
- The service will be available at the URL provided after deployment
- Logs can be viewed with: `gcloud run logs tail antragplus-api --region=europe-west3`