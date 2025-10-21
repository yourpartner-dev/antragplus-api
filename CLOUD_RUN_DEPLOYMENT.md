# Cloud Run Deployment Fix for 503 Errors

## Problem

Cloud Run was returning 503 errors because:
1. The application wasn't listening on port 8055 within the startup probe timeout (240s)
2. The `bootstrap` command was blocking server startup by running database migrations
3. The PORT environment variable was missing from Cloud Run configuration
4. Request timeout was too short (default 300s) for long-running operations (application generation, NGO crawling)

## Solution Applied

### 1. Fixed Dockerfile (CRITICAL)
**File**: `Dockerfile` line 77

**Before**:
```dockerfile
CMD ["sh", "-c", "node dist/cli/run.js bootstrap && node dist/start.js"]
```

**After**:
```dockerfile
CMD ["node", "dist/start.js"]
```

**Why**: The server now starts immediately and can respond to health checks. Bootstrap must be run separately.

### 2. Added PORT Environment Variable
**File**: `.env.cloudrun.yaml` line 2

Added:
```yaml
PORT: "8055"
```

**Why**: Cloud Run needs to know which port the application listens on.

### 3. Configure Request Timeout (CRITICAL)

**⚠️ REQUIRED**: The `--timeout 600` flag must be set during deployment.

Cloud Run's default request timeout is **300 seconds (5 minutes)**, which is insufficient for these operations:

| Endpoint | Operation | Typical Duration | Why It's Slow |
|----------|-----------|------------------|---------------|
| `POST /ai/applications/:id/generate` | Application generation | 2-5 minutes | AI document generation + web search + database queries |
| `POST /ai/ngo` | NGO website crawling | 7-8 minutes | Crawls up to 15 pages (30s timeout each) + AI extraction |
| `POST /ai/chat` | Chat with web search | 1-3 minutes | RAG context building + external web search + streaming response |

**Without this setting**, users will see network errors or 503 responses when these operations exceed 5 minutes.

**Setting**: `--timeout 600` (10 minutes) in the deployment command below.

## Deployment Instructions

### First-Time Deployment (Database Bootstrap Required)

1. **Build and push Docker image**:
```bash
# From antragplus-api directory
gcloud builds submit --tag gcr.io/antragplus-472111/antragplus-api
```

2. **Run bootstrap as a one-time Cloud Run job** (REQUIRED before first deployment):
```bash
gcloud run jobs create antragplus-bootstrap \
  --image gcr.io/antragplus-472111/antragplus-api \
  --region europe-west3 \
  --env-vars-file .env.cloudrun.yaml \
  --task-timeout 10m \
  --max-retries 0 \
  --command "node,dist/cli/run.js,bootstrap"

gcloud run jobs execute antragplus-bootstrap --region europe-west3 --wait
```

3. **Deploy the service with correct timeout settings**:
```bash
gcloud run deploy antragplus-api \
  --image gcr.io/antragplus-472111/antragplus-api \
  --region europe-west3 \
  --env-vars-file .env.cloudrun.yaml \
  --timeout 600 \
  --cpu 2 \
  --memory 4Gi \
  --min-instances 1 \
  --max-instances 10 \
  --allow-unauthenticated \
  --port 8055
```

### Subsequent Deployments (No Bootstrap Needed)

For regular updates after the database is already initialized:

1. **Build and push**:
```bash
gcloud builds submit --tag gcr.io/antragplus-472111/antragplus-api
```

2. **Deploy**:
```bash
gcloud run deploy antragplus-api \
  --image gcr.io/antragplus-472111/antragplus-api \
  --region europe-west3
```

### When to Run Bootstrap Again

Run the bootstrap job only when:
- First-time deployment to a new environment
- After adding new database migrations
- After database reset/restore

**To run bootstrap manually**:
```bash
gcloud run jobs execute antragplus-bootstrap --region europe-west3 --wait
```

## Configuration Explained

### Critical Settings

#### ⚠️ 1. **`--timeout 600`** (10 minutes) - MANDATORY

**This is the most critical setting to prevent 503 errors!**

Cloud Run's default timeout is only **300 seconds (5 minutes)**. Your application has operations that can take longer:

- **Application Generation** (`/ai/applications/:id/generate`): 2-5 minutes
  - Fetches grant requirements and NGO data from database
  - Performs web search for additional context
  - Generates multiple documents with AI (Claude Opus)
  - Streams progress updates to frontend

- **NGO Website Crawling** (`/ai/ngo`): 7-8 minutes
  - Discovers pages via sitemap or common patterns
  - Crawls up to 15 pages with 30-second timeout per page
  - Extracts structured data with AI
  - Can take up to 8 minutes for large NGO websites

- **AI Chat with Web Search** (`/ai/chat`): 1-3 minutes
  - Builds RAG context from embeddings
  - Performs external web search via Tavily
  - Streams AI response

**What happens without `--timeout 600`?**
- Requests longer than 5 minutes return 504 Gateway Timeout
- Users see "Network Error" or incomplete operations
- Frontend shows failed requests even though backend continues processing

**How to verify timeout is set:**
```bash
gcloud run services describe antragplus-api --region europe-west3 --format="value(spec.template.spec.containers[0].timeoutSeconds)"
# Should return: 600
```

#### 2. **`--port 8055`**
   - Must match the PORT in `.env.cloudrun.yaml`
   - Must match the server port in `src/server.ts`
   - Cloud Run routes traffic to this port

#### 3. **`--cpu 2 --memory 4Gi`**
   - AI operations (embeddings, LLM calls) are memory-intensive
   - Crawlee web scraping requires CPU for concurrent requests
   - Scheduler jobs process large batches of embeddings
   - Insufficient memory causes OOM errors and 503 responses

### Optional Performance Settings

- **`--min-instances 1`**: Prevents cold starts (costs more but better UX)
- **`--max-instances 10`**: Limits concurrent instances (adjust based on traffic)

## Monitoring

### Check Service Status
```bash
gcloud run services describe antragplus-api --region europe-west3
```

### View Logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=antragplus-api" \
  --limit 50 \
  --format "table(timestamp,severity,textPayload)"
```

### Check for 503 Errors
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=antragplus-api AND httpRequest.status=503" \
  --limit 20
```

## Troubleshooting

### Service Still Returns 503

**Symptom**: Endpoints return "Service Unavailable"

**Check**:
1. Verify server is listening:
   ```bash
   gcloud logging read "textPayload:'Server started at'" --limit 1
   ```

2. Check startup probe:
   ```bash
   gcloud run services describe antragplus-api --region europe-west3 --format="value(status.conditions)"
   ```

3. Verify PORT environment variable:
   ```bash
   gcloud run services describe antragplus-api --region europe-west3 --format="value(spec.template.spec.containers[0].env)"
   ```

### Long-Running Requests Time Out

**Symptom**: Application generation or NGO crawling fails mid-process, returns "Network Error"

**First, verify the timeout is configured:**
```bash
gcloud run services describe antragplus-api --region europe-west3 --format="value(spec.template.spec.containers[0].timeoutSeconds)"
```

**Expected output**: `600`

**If it returns `300` or empty**, update the timeout:
```bash
gcloud run services update antragplus-api \
  --region europe-west3 \
  --timeout 600
```

**If timeout is already 600s and requests still fail:**
1. Check Cloud Run logs for the actual error:
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=antragplus-api AND severity>=ERROR" --limit 20
   ```

2. Check for specific operation timeouts:
   - NGO crawling: Each page has 30s timeout (see `ngo-fetch-tool.ts:60`)
   - Application generation: No individual operation timeout
   - If consistently failing at same point, there may be an external API timeout

3. Consider optimizing the operation:
   - Reduce max pages for NGO crawling (currently 15 pages)
   - Reduce web search results
   - Add caching for repeated operations

4. For operations consistently taking >10 minutes, move to async processing:
   - Use Cloud Tasks for background processing
   - Return job ID immediately to frontend
   - Poll for completion or use webhooks

### Bootstrap Job Fails

**Symptom**: Database initialization doesn't complete

**Check**:
1. View job execution logs:
   ```bash
   gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=antragplus-bootstrap" --limit 50
   ```

2. Verify database connectivity (check Cloud SQL IP in `.env.cloudrun.yaml`)

3. Manually check if database is accessible:
   ```bash
   # From Cloud Shell or with Cloud SQL proxy
   psql -h 10.105.32.3 -U antragplus_user -d antragplus
   ```

## Rollback

If deployment causes issues:

```bash
# List revisions
gcloud run revisions list --service antragplus-api --region europe-west3

# Rollback to previous working revision
gcloud run services update-traffic antragplus-api \
  --region europe-west3 \
  --to-revisions REVISION_NAME=100
```

## Related Files

- `Dockerfile` - Container build instructions
- `.env.cloudrun.yaml` - Cloud Run environment variables
- `src/server.ts` - Server startup and port configuration
- `src/cli/commands/bootstrap/index.ts` - Database initialization
