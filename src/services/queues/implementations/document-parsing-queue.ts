import { BaseQueue } from '../base-queue.js';
import { QueueName } from '../types/queue.js';
import getDatabase from '../../../database/index.js';
import { documentParser } from '../../files/lib/document-parser.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';

export interface DocumentParsingJobPayload {
  file_id: string;
  storage_location: string;
  filename_disk: string;
  mime_type: string;
  user_id?: string;
  accountability: Accountability | null;
  schema: SchemaOverview;
}

/**
 * Queue for processing document parsing jobs
 * Extracts text content from uploaded documents for RAG and search
 */
export class DocumentParsingQueue extends BaseQueue {
  constructor(schema: SchemaOverview, accountability: Accountability | null) {
    super(QueueName.DOCUMENT_PARSING, schema, accountability);
    this.maxRetries = 2;
  }

  /**
   * Add document parsing jobs to the queue
   * This is the public method that external services use to queue parsing jobs
   */
  public async addDocumentParsingJobs(jobs: Array<{
    file_id: string;
    storage_location: string;
    filename_disk: string;
    mime_type: string;
    user_id?: string;
  }>): Promise<void> {
    const items = jobs.map(job => ({
      ...job,
      accountability: this.accountability,
      schema: this.schema
    }));

    await this.addBatchToQueue(items);
  }

  /**
   * Process the queue continuously
   */
  public async processQueue(): Promise<void> {
    while (true) {
      const queueSize = await this.getQueueSize();
      if (queueSize === 0) break;
      
      await this.process();
    }
  }

  /**
   * Process document parsing jobs from the queue
   * Required implementation of abstract method from BaseQueue
   */
  public async process(): Promise<void> {
    let job;

    while ((job = await this.getFromQueue())) {
      try {
        const payload = job as DocumentParsingJobPayload;
        const lockKey = `document-parsing:${payload.file_id}`;

        await this.withQueueItemLock(lockKey, async () => {
          // Check retry count
          const retryCount = await this.getRetryCount(lockKey);
          if (retryCount > this.maxRetries) {
            this.logger.warn(`Max retries exceeded for document parsing job: ${lockKey}`);
            await this.clearRetryCount(lockKey);
            return;
          }

          try {
            await this.processDocumentParsingJob(payload);
            await this.clearRetryCount(lockKey);
          } catch (error) {
            // Handle retry logic
            await this.handleRetry(lockKey, retryCount, async () => {
              await this.addDocumentParsingJobs([{
                file_id: payload.file_id,
                storage_location: payload.storage_location,
                filename_disk: payload.filename_disk,
                mime_type: payload.mime_type,
                ...(payload.user_id !== undefined && { user_id: payload.user_id })
              }]);
            }, error);
          }
        });
      } catch (error) {
        this.logger.error(error, `Failed to process document parsing job`);
        await this.handleFailedItem(job, error as Error);
      }
    }
  }


  /**
   * Process a single document parsing job
   */
  private async processDocumentParsingJob(payload: DocumentParsingJobPayload): Promise<void> {
    const { file_id, storage_location, filename_disk, mime_type, user_id, accountability } = payload;
    
    this.logger.info(`Processing document parsing job for file: ${file_id}`);

    try {
      // Check if document type is supported
      if (!documentParser.isSupported(mime_type)) {
        this.logger.debug(`Skipping unsupported file type: ${mime_type} for file ${file_id}`);
        return;
      }

      // Parse the document
      const content = await documentParser.parseDocument(
        storage_location,
        filename_disk,
        mime_type
      );

      if (!content || !content.text) {
        this.logger.warn(`No content extracted from file ${file_id}`);
        return;
      }

      // Store the extracted content
      await documentParser.storeExtractedContent(
        file_id,
        content,
        user_id || accountability?.user || undefined
      );

      // Log activity
      if (user_id || accountability?.user) {
        const knex = getDatabase();
        try {
          await knex('ai_activity_logs').insert({
            user_id: user_id || accountability?.user,
            activity_type: 'document_parsed',
            entity_type: 'yp_files',
            entity_id: file_id,
            description: `Document parsed and indexed for search`,
            metadata: {
              mime_type,
              word_count: content.wordCount,
              page_count: content.pageCount,
              text_length: content.text.length,
            },
            ip_address: accountability?.ip || null,
            user_agent: accountability?.userAgent || null,
            created_at: new Date()
          });
        } catch (logError) {
          this.logger.error(logError, 'Failed to log document parsing activity');
        }
      }

      this.logger.info(`Successfully parsed document ${file_id} - extracted ${content.text.length} characters`);
    } catch (error) {
      this.logger.error(`Error processing document parsing job for file ${file_id}:`, error);
      throw error;
    }
  }

}