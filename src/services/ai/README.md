# Embedding System Documentation

This document provides a comprehensive guide to the embedding system that powers RAG (Retrieval-Augmented Generation) functionality in AntragPlus.

## Overview

The embedding system automatically vectorizes **ALL text content** from the entire database, enabling comprehensive semantic search and contextual AI responses. It uses a combination of event-based triggers and scheduled workers to maintain up-to-date embeddings across all content tables.

### **Comprehensive Content Coverage:**
- **NGO Profiles**: `ngos` - About, field of work, funding types
- **Grant Information**: `grants` - Descriptions, criteria, processes, requirements  
- **Applications**: `applications` - Project descriptions, solutions, outcomes
- **AI-Generated Content**: `application_content` - AI-assisted application drafts
- **Content Versions**: `application_content_versions` - Version history tracking
- **User Documents**: `application_attachments` - Uploaded PDFs, Word docs, etc.
- **Grant Documents**: `grant_documents` - Grant guidelines, templates, examples
- **Knowledge Snippets**: `ngo_snippets` - Reusable content blocks
- **Chat History**: `chat_messages` - AI conversation context
- **Parsed Documents**: `document_extracts` - Text extracted from uploaded files
- **Structured Data**: `extracted_data` - AI-extracted forms and data

## Architecture

### Components

1. **Embedding Queue (`embedding-queue.ts`)**: Processes embedding generation/update jobs
2. **Embedding Processor (`embedding-processor.ts`)**: Scheduled jobs for maintenance
3. **Embedding Hooks (`embedding-hooks.ts`)**: Event-based triggers for content changes
4. **RAG Service (`rag-service.ts`)**: Retrieval and context building
5. **REST API (`controllers/embeddings.ts`)**: Manual control and monitoring

### Database Tables

- **`embeddings`**: Stores vectorized content chunks
- **`embedding_queue`**: Tracks pending embedding jobs
- **`rag_context_cache`**: Caches retrieved context for performance

## Workflow

### 1. Content Creation/Update (Redis-Based)

When content is created or updated:

```
User Action → Database Change → Hook Triggered → Redis Queue (RPUSH) → Scheduler (LPOP) → Processing → Embeddings Generated
```

**Detailed Flow:**
- **Hook Triggered**: `queueEmbeddingOnCreate/Update/Delete` in `embedding-hooks.ts`
- **Redis Queue**: Jobs added via `addEmbeddingJobs()` to Redis lists
- **Scheduler Processing**: `processEmbeddingQueue()` runs every minute, calls `processQueue()`
- **Queue Processing**: `EmbeddingQueue.process()` handles Redis LPOP, distributed locking, retries

### 2. Document Processing (Redis-Based)

When files are uploaded:

```
File Upload → Document Parsing Hook → Redis DocumentParsingQueue → Text Extraction → Content Storage → Embedding Queue
```

**Detailed Flow:**
- **Upload Hook**: `parseDocumentOnUpload` in `document-parsing-hooks.ts`
- **Redis Queue**: Jobs added via `addDocumentParsingJobs()` 
- **Text Extraction**: DocumentParser processes files from storage backends
- **Content Storage**: Extracted text stored in `document_extracts` table
- **Auto-Embedding**: Triggers embedding generation for extracted content

### 3. Retrieval Flow

When context is needed:

```
Query → Generate Query Embedding → Vector Search → Filter Results → Build Context → Cache → Return
```

## Implementation Guide

### Setting Up

1. **Install pgvector extension**:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

2. **Configure OpenAI API** (or your embedding provider):
```typescript
// In embedding-queue.ts, replace the mock implementation:
private async generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });
  return response.data[0].embedding;
}
```

3. **Hooks are auto-registered** in your app initialization:
```typescript
// Hooks are automatically imported in src/hooks/index.ts:
import './embedding-hooks.js';
import './document-parsing-hooks.js';

// This registration happens automatically in app.ts:
import './hooks/index.js';
```

4. **Initialize scheduler** in app.ts:
```typescript
import { initializeEmbeddingProcessor } from './schedulers/embedding-processor.js';

// Scheduler initializes without parameters (creates its own QueueManager)
initializeEmbeddingProcessor();
```

5. **Add embeddings router** to your API:
```typescript
import embeddingsRouter from './controllers/embeddings.js';

// In your route setup
app.use('/embeddings', embeddingsRouter);
```

## Usage Examples

### Manual Embedding Generation

```bash
# Queue embeddings for specific items
curl -X POST http://localhost:8055/embeddings/queue \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {"source_table": "ngos", "source_id": "123", "operation": "update"},
      {"source_table": "grants", "source_id": "456", "operation": "insert"}
    ]
  }'
```

### Semantic Search

```bash
# Search for similar content
curl -X POST http://localhost:8055/embeddings/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "education programs for children",
    "options": {
      "limit": 10,
      "filter": {
        "ngo_id": "123"
      }
    }
  }'
```

### Build Context for Chat

```typescript
const context = await ragService.buildContext(
  "Tell me about grant requirements",
  chatId,
  {
    filter: {
      grant_id: grantId,
      language: 'en-US'
    },
    limit: 20
  }
);
```

## Scheduled Jobs

### Process Embedding Queue (Every minute)
- Processes pending jobs from **Redis embedding queue** (not database table)
- Uses `EmbeddingQueue.processQueue()` with distributed locking and retries
- Handles Redis LPOP operations with proper error handling

### Process Grant Extraction Queue (Every minute)
- Processes pending jobs from **Redis grant extraction queue**
- Uses `GrantExtractionQueue.processQueue()` for AI-powered grant parsing

### Process Document Parsing Queue (Every 30 seconds)  
- Processes pending jobs from **Redis document parsing queue**
- Uses `DocumentParsingQueue.processQueue()` for text extraction from files

### Refresh Stale Embeddings (Hourly)
- Finds content where `updated_at > last_embedded` 
- **Only checks tables with `updated_at` columns**: `ngos`, `grants`, `applications`, `application_content`, `ngo_snippets`, `document_extracts`, `extracted_data`
- **Excludes reference/version tables**: `application_content_versions`, `application_attachments`, `grant_documents` (these only have `created_at`)
- **Queues to Redis**: Uses `addEmbeddingJobs()` to queue refresh jobs

### Cleanup Orphaned Embeddings (Daily at 3 AM)
- Removes embeddings for deleted content (direct database operation)
- **Note**: Deletions don't need queueing, processed immediately  

### Generate Missing Embeddings (Every 15 minutes)
- Finds content without any embeddings
- **Queues to Redis**: Uses `addEmbeddingJobs()` to queue generation jobs

## Configuration

### Embedding Parameters

```typescript
// In embedding-queue.ts
const CHUNK_SIZE = 2000; // Characters per chunk
const EMBEDDING_MODEL = "text-embedding-ada-002"; // OpenAI model
const EMBEDDING_DIMENSIONS = 1536; // Vector dimensions
```

### Queue Settings

```typescript
// In embedding-queue.ts constructor
{
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  processingTimeout: 60000, // 1 minute per job
}
```

### Search Parameters

```typescript
// Default RAG search options
{
  limit: 10,
  threshold: 0.7, // Minimum similarity score
  boostRecent: true, // Boost recently updated content
}
```

## Performance Optimization

### 1. Batch Processing
Embeddings are processed in batches to optimize API calls and database operations.

### 2. Caching
- Redis caching for frequently accessed contexts
- Database caching with TTL for chat contexts

### 3. Indexing
- IVFFlat indexes for fast vector similarity search
- B-tree indexes for metadata filtering

### 4. Chunking Strategy
- Smart sentence-based chunking to preserve context
- Overlap between chunks for continuity

## Monitoring

### Health Check
```bash
curl http://localhost:8055/embeddings/health
```

### Statistics
```bash
curl http://localhost:8055/embeddings/stats
```

### Queue Status
Monitor via logs or query the `embedding_queue` table:
```sql
SELECT status, COUNT(*) 
FROM embedding_queue 
GROUP BY status;
```

## Troubleshooting

### Common Issues

1. **Embeddings not generating**
   - Check if pgvector extension is installed
   - Verify API keys for embedding provider
   - Check queue processor logs

2. **Slow search performance**
   - Ensure IVFFlat indexes are created
   - Check if embedding dimensions match
   - Monitor chunk sizes

3. **High memory usage**
   - Reduce batch sizes
   - Implement pagination for large result sets
   - Check for memory leaks in embedding generation

### Debug Queries

```sql
-- Check embedding coverage
SELECT source_table, COUNT(DISTINCT source_id) as sources, COUNT(*) as chunks
FROM embeddings
GROUP BY source_table;

-- Find failed jobs
SELECT * FROM embedding_queue
WHERE status = 'failed'
ORDER BY created_at DESC;

-- Check vector index usage
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM embeddings
ORDER BY embedding <=> '[...]'::vector
LIMIT 10;
```

## Critical Implementation Notes

### **🔒 System-Level Permissions (IMPORTANT)**
**CRITICAL**: The embedding queue uses **null accountability** for system-level access to read all content regardless of user permissions.

**Implementation Details:**
- `fetchSourceContent()` and `getSourceMetadata()` in `embedding-queue.ts` use `accountability: null`
- This bypasses all permission checks to ensure comprehensive embedding coverage
- System jobs need access to all content (grants, documents, applications, etc.)

**Security Considerations:**
- Embedding generation is a background system process, not user-initiated
- Final embeddings don't expose content directly, only enable semantic search
- RAG retrieval still respects user permissions through query-time filtering

**⚠️ Future Considerations:**
If you need to restore permission-based embedding (respecting user access):
1. Remove `accountability: null` from ItemsService calls
2. Use the job payload accountability: `new ItemsService(table, { accountability, schema })`
3. Accept that some content may not be embeddable for all users
4. Consider impact on AI response completeness

### **🚨 Complete Database Coverage**
**CRITICAL**: The AI system requires embeddings from **ALL content tables** to provide comprehensive answers. Missing tables will create knowledge gaps.

**Required Tables** (all included in `EMBEDDABLE_TABLES`):
- Core entities: `ngos`, `grants`, `applications`
- AI content: `application_content`, `application_content_versions`  
- Documents: `application_attachments`, `grant_documents`, `document_extracts`
- Interactions: `chat_messages`, `ngo_snippets`, `extracted_data`

**Verification Checklist:**
```sql
-- Check embedding coverage across all tables
SELECT source_table, COUNT(DISTINCT source_id) as sources, COUNT(*) as chunks
FROM embeddings 
GROUP BY source_table 
ORDER BY source_table;
```

### **🔧 Hybrid Queue Architecture**
The embedding system uses a **hybrid database + Redis approach** for optimal reliability and performance:
- **Job Persistence**: `embedding_queue` database table stores job data persistently
- **Coordination**: Redis provides distributed locking (`withQueueItemLock`) and retry counters
- **Processing**: Scheduler polls database table for pending jobs every minute
- **Workflow**: Hooks → Database table inserts → Scheduler polling → Redis coordination → Processing

**Why Hybrid?**
- **Database**: Survives system restarts, provides ACID compliance, supports complex queries
- **Redis**: Enables distributed processing, fast locking, retry coordination
- **Best of Both**: Persistence guarantees + real-time coordination

## Best Practices

1. **Content Preparation**
   - Clean and normalize text before embedding
   - Include relevant metadata for filtering
   - Use consistent language codes

2. **Chunking**
   - Keep chunks semantic and complete
   - Avoid splitting mid-sentence
   - Include context from headers/titles

3. **Metadata**
   - Always include entity relationships (ngo_id, grant_id)
   - Add language information
   - Include timestamps for recency ranking

4. **Performance**
   - Use appropriate chunk sizes (500-2000 chars)
   - Implement request throttling for API calls
   - Monitor and clean up old embeddings

## Future Enhancements

1. **Multi-model Support**: Add support for different embedding models
2. **Incremental Updates**: Only re-embed changed portions
3. **Cross-lingual Search**: Implement multilingual embeddings
4. **Hybrid Search**: Combine vector search with keyword search
5. **Feedback Loop**: Use user interactions to improve relevance
