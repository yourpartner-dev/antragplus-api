import { BaseQueue } from '../base-queue.js';
import { QueueName } from '../types/queue.js';
import { ItemsService } from '../../items.js';
import getDatabase from '../../../database/index.js';
import { embeddingProvider } from '../../ai/embeddings/openai-embeddings.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';
import type { Knex } from 'knex';

export interface EmbeddingJobPayload {
  source_table: string;
  source_id: string;
  operation: 'insert' | 'update' | 'delete';
  priority?: number;
  fields_to_embed?: string[]; // Optional: specific fields to embed
  accountability: Accountability | null;
  schema: SchemaOverview;
}

export interface EmbeddingChunk {
  source_table: string;
  source_id: string;
  source_field: string;
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
  metadata: Record<string, any>;
}

/**
 * Queue for processing embedding generation/updates
 * Handles vectorization of content from various tables
 */
export class EmbeddingQueue extends BaseQueue {

  constructor(schema: SchemaOverview, accountability: Accountability | null) {
    super(QueueName.EMBEDDING, schema, accountability);
    this.maxRetries = 3;
  }

  /**
   * Add embedding jobs to the queue
   * This is the public method that external services use to queue embedding jobs
   */
  public async addEmbeddingJobs(jobs: Array<{
    source_table: string;
    source_id: string;
    operation: 'insert' | 'update' | 'delete';
    priority?: number;
    fields_to_embed?: string[];
  }>): Promise<void> {
    const items = jobs.map(job => ({
      ...job,
      accountability: this.accountability,
      schema: this.schema
    }));

    await this.addBatchToQueue(items);
  }

  /**
   * Process the queue continuously with rate limiting
   */
  public async processQueue(): Promise<void> {
    let processedCount = 0;
    const maxBatchSize = 10; // Limit processing to prevent resource exhaustion

    while (processedCount < maxBatchSize) {
      const queueSize = await this.getQueueSize();
      if (queueSize === 0) break;

      await this.process();
      processedCount++;

      // Add small delay between items to prevent overwhelming the system
      if (processedCount < maxBatchSize) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (processedCount >= maxBatchSize) {
      this.logger.info(`Processed ${processedCount} items, stopping to prevent resource exhaustion`);
    }
  }

  /**
   * Process embedding jobs from the queue
   * Required implementation of abstract method from BaseQueue
   */
  public async process(): Promise<void> {
    let job;

    while ((job = await this.getFromQueue())) {
      try {
        const payload = job as EmbeddingJobPayload;
        const lockKey = `embedding:${payload.source_table}:${payload.source_id}`;

        await this.withQueueItemLock(lockKey, async () => {
          // Check retry count
          const retryCount = await this.getRetryCount(lockKey);
          if (retryCount > this.maxRetries) {
            this.logger.warn(`Max retries exceeded for embedding job: ${lockKey}`);
            await this.clearRetryCount(lockKey);
            return;
          }

          try {
            await this.processEmbeddingJob(payload);
            await this.clearRetryCount(lockKey);
          } catch (error) {
            // Handle retry logic
            await this.handleRetry(lockKey, retryCount, async () => {
              await this.addEmbeddingJobs([{
                source_table: payload.source_table,
                source_id: payload.source_id,
                operation: payload.operation,
                ...(payload.priority !== undefined && { priority: payload.priority }),
                ...(payload.fields_to_embed !== undefined && { fields_to_embed: payload.fields_to_embed })
              }]);
            }, error);
          }
        }, 120000); // 2 minutes timeout for embedding operations (handles slow OpenAI API)
      } catch (error) {
        this.logger.error(error, `Failed to process embedding job`);
        await this.handleFailedItem(job, error as Error);
      }
    }
  }

  /**
   * Process a single embedding job
   */
  private async processEmbeddingJob(payload: EmbeddingJobPayload): Promise<void> {
    const startTime = Date.now();
    this.logger.info(`Processing embedding job for ${payload.source_table}:${payload.source_id}`);

    const knex = getDatabase();

    if (payload.operation === 'delete') {
      await this.deleteEmbeddings(knex, payload.source_table, payload.source_id);
      const duration = Date.now() - startTime;
      this.logger.info(`Deleted embeddings for ${payload.source_table}:${payload.source_id} in ${duration}ms`);
      return;
    }

    // Fetch content from source
    const content = await this.fetchSourceContent(
      payload.source_table,
      payload.source_id,
      payload.fields_to_embed,
      payload.schema
    );

    if (!content || Object.keys(content).length === 0) {
      this.logger.warn(`No content found for ${payload.source_table}:${payload.source_id}`);
      return;
    }

    // Delete existing embeddings
    await this.deleteEmbeddings(knex, payload.source_table, payload.source_id);

    // Generate new embeddings
    const chunks = await this.generateEmbeddings(
      payload.source_table,
      payload.source_id,
      content,
      payload.schema
    );

    // Store embeddings
    await this.storeEmbeddings(knex, chunks);

    const duration = Date.now() - startTime;
    this.logger.info(
      `Successfully processed ${chunks.length} embeddings for ${payload.source_table}:${payload.source_id} in ${duration}ms`
    );

    // Warn if operation took longer than 20 seconds
    if (duration > 20000) {
      this.logger.warn(`Slow embedding job: ${duration}ms for ${payload.source_table}:${payload.source_id} (${chunks.length} chunks)`);
    }
  }

  /**
   * Fetch content from the source table
   */
  private async fetchSourceContent(
    sourceTable: string,
    sourceId: string,
    fieldsToEmbed: string[] | undefined,
    schema: SchemaOverview
  ): Promise<Record<string, string>> {
    const content: Record<string, string> = {};

    // Map of tables to their text fields that should be embedded
    const embeddableFields: Record<string, string[]> = {
      ngos: ['name', 'description', 'about', 'field_of_work', 'funding_type'],
      grants: [
        'name',
        'description',
        'eligibility_criteria',
        'application_process',
        'evaluation_criteria',
        'reporting_requirements',
      ],
      applications: [
        'project_title',
        'project_description',
        'problem_statement',
        'target_audience',
        'proposed_solution',
        'expected_outcomes',
      ],
      documents: ['title', 'content'],
      grant_documents: ['metadata'], // Grant document metadata contains description
      application_attachments: ['content'], // Application attachment content  
      ngo_snippets: ['title', 'content'],
      chat_messages: ['content'],
      document_extracts: ['content_text'], // Full text from parsed documents
    };

    // Use provided fields or default to all embeddable fields for the table
    const fields = fieldsToEmbed || embeddableFields[sourceTable] || [];

    if (fields.length === 0) {
      this.logger.warn(`No embeddable fields defined for table: ${sourceTable}`);
      return content;
    }

    try {
      // Use null accountability for system-level access to read any content for embeddings
      const itemsService = new ItemsService(sourceTable, { accountability: null, schema });
      const item = await itemsService.readOne(sourceId, {
        fields: [...fields, 'language', 'ngo_id', 'grant_id', 'application_id'],
      });

      if (!item) {
        return content;
      }

      // Extract text content from fields
      for (const field of fields) {
        if (item[field]) {
          // Special handling for grant_documents metadata
          if (sourceTable === 'grant_documents' && field === 'metadata') {
            const metadata = typeof item[field] === 'string' ? JSON.parse(item[field]) : item[field];
            if (metadata && metadata.description) {
              content['description'] = String(metadata.description);
            }
          } else {
            content[field] = String(item[field]);
          }
        }
      }

      // Create a combined field for better context
      const combinedText = Object.values(content).join(' ');
      if (combinedText) {
        content['_combined'] = combinedText;
      }

      return content;
    } catch (error) {
      this.logger.error(error, `Error fetching content from ${sourceTable}:`);
      throw error;
    }
  }

  /**
   * Generate embeddings for content
   */
  private async generateEmbeddings(
    sourceTable: string,
    sourceId: string,
    content: Record<string, string>,
    schema: SchemaOverview
  ): Promise<EmbeddingChunk[]> {
    const chunks: EmbeddingChunk[] = [];

    // Fetch metadata for the source item
    const metadata = await this.getSourceMetadata(
      sourceTable,
      sourceId,
      schema
    );

    // Collect all chunks first for batch processing
    const allChunks: Array<{
      field: string;
      text: string;
      index: number;
      totalChunks: number;
    }> = [];

    for (const [field, text] of Object.entries(content)) {
      if (!text) continue;

      // Split text into chunks (max ~500 tokens ≈ 2000 chars)
      const textChunks = this.splitIntoChunks(text, 2000);

      for (let i = 0; i < textChunks.length; i++) {
        const chunkText = textChunks[i];
        if (chunkText) {
          allChunks.push({
            field,
            text: chunkText,
            index: i,
            totalChunks: textChunks.length,
          });
        }
      }
    }

    if (allChunks.length === 0) {
      return chunks;
    }

    // Generate embeddings in smaller batches to prevent timeouts
    const batchSize = 10;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      const texts = batch.map(chunk => chunk.text);

      try {
        // Try batch processing first
        const batchStartTime = Date.now();
        const embeddings = await embeddingProvider.generateBatchEmbeddings(texts);
        const batchDuration = Date.now() - batchStartTime;

        if (batchDuration > 10000) { // Warn if batch took >10s
          this.logger.warn(`Slow embedding batch: ${batchDuration}ms for ${texts.length} chunks`);
        }

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const embedding = embeddings[j];
          if (!chunk || !embedding) continue;
          
          chunks.push({
            source_table: sourceTable,
            source_id: sourceId,
            source_field: chunk.field,
            chunk_index: chunk.index,
            chunk_text: chunk.text,
            embedding: embedding,
            metadata: {
              ...metadata,
              field: chunk.field,
              chunk_count: chunk.totalChunks,
            },
          });
        }
      } catch (error) {
        // Fallback to individual processing if batch fails
        this.logger.warn(error, 'Batch embedding failed, falling back to individual processing');
        
        for (const chunk of batch) {
          const embedding = await this.generateEmbedding(chunk.text);
          chunks.push({
            source_table: sourceTable,
            source_id: sourceId,
            source_field: chunk.field,
            chunk_index: chunk.index,
            chunk_text: chunk.text,
            embedding: embedding,
            metadata: {
              ...metadata,
              field: chunk.field,
              chunk_count: chunk.totalChunks,
            },
          });
        }
      }
    }

    return chunks;
  }

  /**
   * Split text into manageable chunks
   */
  private splitIntoChunks(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxLength && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += ' ' + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Generate embedding vector for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      return await embeddingProvider.generateEmbedding(text);
    } catch (error) {
      this.logger.error(error, 'Error generating embedding:');
      throw error;
    }
  }

  /**
   * Get metadata for the source item
   */
  private async getSourceMetadata(
    sourceTable: string,
    sourceId: string,
    schema: SchemaOverview
  ): Promise<Record<string, any>> {
    try {
      // Use null accountability for system-level access to read metadata
      const itemsService = new ItemsService(sourceTable, { accountability: null, schema });
      const item = await itemsService.readOne(sourceId, {
        fields: ['language', 'ngo_id', 'grant_id', 'application_id', 'status', 'category'],
      });

      const metadata: Record<string, any> = {
        entity_type: sourceTable,
      };

      if (item) {
        if (item['language']) metadata['language'] = item['language'];
        if (item['ngo_id']) metadata['ngo_id'] = item['ngo_id'];
        if (item['grant_id']) metadata['grant_id'] = item['grant_id'];
        if (item['application_id']) metadata['application_id'] = item['application_id'];
        if (item['status']) metadata['status'] = item['status'];
        if (item['category']) metadata['category'] = item['category'];
      }

      return metadata;
    } catch (error) {
      this.logger.error(error, 'Error fetching metadata:');
      return { entity_type: sourceTable };
    }
  }

  /**
   * Delete existing embeddings for a source
   */
  private async deleteEmbeddings(
    knex: Knex,
    sourceTable: string,
    sourceId: string
  ): Promise<void> {
    await knex('embeddings')
      .where('source_table', sourceTable)
      .where('source_id', sourceId)
      .delete();
  }

  /**
   * Store embeddings in the database
   */
  private async storeEmbeddings(knex: Knex, chunks: EmbeddingChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    const records = chunks.map((chunk) => ({
      source_table: chunk.source_table,
      source_id: chunk.source_id,
      source_field: chunk.source_field,
      chunk_index: chunk.chunk_index,
      chunk_text: chunk.chunk_text,
      // PostgreSQL pgvector expects the embedding as a string in format '[x,y,z]'
      embedding: `[${chunk.embedding.join(',')}]`,
      metadata: chunk.metadata,
      created_at: new Date(),
      updated_at: new Date(),
    }));

    // Insert in batches to avoid hitting query size limits
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await knex('embeddings').insert(batch);
    }
  }
}