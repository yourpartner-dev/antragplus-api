import { BaseQueue } from '../base-queue.js';
import { QueueName } from '../types/queue.js';
import getDatabase from '../../../database/index.js';
import { GrantExtractionService } from '../../ai/grants/grant-extraction-service.js';
import { NotificationsService } from '../../notifications.js';
import { useEnv } from '../../../helpers/env/index.js';
import type { Accountability, SchemaOverview } from '../../../types/index.js';

/**
 * Queue for processing grant document extraction jobs
 * Processes files in batches and creates a grant when all files are complete
 */
export class GrantExtractionQueue extends BaseQueue {
  constructor(schema: SchemaOverview, accountability: Accountability | null) {
    super(QueueName.GRANT_EXTRACTION, schema, accountability);
    this.maxRetries = 2;
  }

  /**
   * Process the queue - this is called by the scheduler
   */
  public async processQueue(): Promise<void> {
    const knex = getDatabase();
    
    // Get pending jobs from grant_extraction_queue table
    const pendingJobs = await knex('grant_extraction_queue')
      .where('status', 'pending')
      .where('retry_count', '<', this.maxRetries)
      .orderBy('created_at', 'asc')
      .limit(25);

    for (const job of pendingJobs) {
      await this.processGrantExtractionJob(job);
    }
  }

  /**
   * Process a single grant extraction job
   */
  private async processGrantExtractionJob(job: any): Promise<void> {
    const knex = getDatabase();
    const lockKey = `grant-extraction:${job.id}`;

    // Use longer timeout for AI processing (60 seconds)
    await this.withQueueItemLock(lockKey, async () => {
      try {
        // Update status to processing
        await knex('grant_extraction_queue')
          .where('id', job.id)
          .update({
            status: 'processing',
            processed_at: new Date(),
          });

        // Check if document has been parsed
        const fileExtract = await knex('document_extracts')
          .where('file_id', job.file_id)
          .first();

        if (!fileExtract) {
          // Document needs to be parsed first - keep as pending
          this.logger.info(`Document extract not found for file ${job.file_id}, will retry later`);
          await knex('grant_extraction_queue')
            .where('id', job.id)
            .update({
              status: 'pending',
              retry_count: knex.raw('retry_count + 1'),
            });
          return;
        }

        // For individual file processing, we just mark it as ready for batch processing
        // The actual AI extraction happens when all files in the batch are ready
        await knex('grant_extraction_queue')
          .where('id', job.id)
          .update({
            status: 'completed',
            extracted_data: {
              file_id: job.file_id,
              document_ready: true,
              word_count: fileExtract.word_count,
              page_count: fileExtract.page_count,
              filename: fileExtract.metadata?.filename || null,
              processed_at: new Date()
            },
            processed_at: new Date(),
          });

        // Check if all files in the batch are completed
        await this.checkBatchCompletion(job.batch_id, job.created_by);

      } catch (error) {
        this.logger.error(error, `Error processing grant extraction job ${job.id}:`);
        
        // Update job with error
        await knex('grant_extraction_queue')
          .where('id', job.id)
          .update({
            status: 'failed',
            error_message: (error as Error).message,
            retry_count: knex.raw('retry_count + 1'),
          });
      }
    }, 60000); // 60 second timeout for AI processing
  }

  /**
   * Check if all files in a batch are completed and update grant if so
   */
  private async checkBatchCompletion(batchId: string, userId: string): Promise<void> {
    const knex = getDatabase();
    
    // Get all jobs in this batch
    const batchJobs = await knex('grant_extraction_queue')
      .where('batch_id', batchId);

    const allCompleted = batchJobs.every(job => job.status === 'completed');
    const hasFailed = batchJobs.some(job => job.status === 'failed' && job.retry_count >= this.maxRetries);
    
    // Get the grant ID from the first job (all jobs in batch should have same grant_id)
    const grantId = batchJobs[0]?.grant_id;
    
    if (!grantId) {
      this.logger.error(`No grant_id found for batch ${batchId}. Jobs should have grant_id set when created.`);
      return;
    }
    
    if (!allCompleted) {
      if (hasFailed) {
        this.logger.error(`Batch ${batchId} has failed jobs. Cannot update grant ${grantId}.`);
        await this.notifyUserGrantFailed(userId, batchId, grantId);
      } else {
        this.logger.debug(`Batch ${batchId} not yet complete. ${batchJobs.filter(j => j.status === 'completed').length}/${batchJobs.length} files processed`);
      }
      return;
    }

    this.logger.info(`All files in batch ${batchId} completed. Updating grant ${grantId}...`);

    try {
      // Get all file IDs from the batch
      const fileIds = batchJobs.map(job => job.file_id);
      
      // Update grant using the extraction service
      const service = new GrantExtractionService({
        accountability: this.accountability,
        schema: this.schema,
      });

      const extractedData = await service.extractGrantFromDocuments({
        file_ids: fileIds,
        created_by: userId,
        accountability: this.accountability,
        schema: this.schema,
      });

      // Get the actual Gemini model name being used for grant extraction
      const env = useEnv();
      const modelName = env['GEMINI_MODEL'] as string || 'gemini-1.5-pro-latest';

      // Store structured extraction data in batch jobs for audit trail
      await knex('grant_extraction_queue')
        .where('batch_id', batchId)
        .update({
          extracted_data: knex.raw('extracted_data || ?', [JSON.stringify({
            batch_extraction: {
              grant_data: extractedData.grant,
              confidence: extractedData.confidence,
              extraction_timestamp: new Date(),
              ai_model_used: modelName,
              total_files_processed: fileIds.length
            }
          })])
        });

      const grant = await service.updateGrantWithExtractedData(
        grantId,
        extractedData,
        fileIds,
        userId
      );

      // Send notification to user
      await this.notifyUserGrantReady(userId, grant);

      this.logger.info(`Grant ${grant.id} updated successfully from batch ${batchId} using model ${modelName} with confidence ${extractedData.confidence}`);
      
    } catch (error: any) {
      this.logger.error(error, `Error processing grant extraction for batch ${batchId}:`);
      
      // Mark batch as failed with proper error tracking
      await knex('grant_extraction_queue')
        .where('batch_id', batchId)
        .update({
          status: 'failed',
          error_message: `Grant extraction failed: ${error.message}`,
          extracted_data: knex.raw('extracted_data || ?', [JSON.stringify({
            error: {
              message: error.message,
              timestamp: new Date(),
              stage: 'ai_extraction_or_grant_update'
            }
          })])
        });

      await this.notifyUserGrantFailed(userId, batchId, grantId);
    }
  }

  /**
   * Send notification to user that their grant is ready
   */
  private async notifyUserGrantReady(userId: string, grant: any): Promise<void> {
    try {
      // Skip notification if no valid user ID
      if (!userId || userId === 'null' || userId === '') {
        this.logger.info(`Skipping grant ready notification - no valid user ID provided for grant ${grant.id}`);
        return;
      }

      const notificationsService = new NotificationsService({
        schema: this.schema,
        accountability: this.accountability,
      });

      await notificationsService.createOne({
        recipient: userId,
        subject: 'Your grant is ready for review',
        message: `Great news! The grant **${grant.name}** from **${grant.provider}** has been successfully processed and is now ready for your review.\n\n` +
                 `[View Grant Details](/dashboard/admin/grants/${grant.id})\n\n` +
                 `**Grant Summary:**\n` +
                 `- **Provider:** ${grant.provider}\n` +
                 `- **Category:** ${grant.category}\n` +
                 `- **Amount Range:** ${grant.currency} ${grant.amount_min?.toLocaleString() || 'N/A'} - ${grant.amount_max?.toLocaleString() || 'N/A'}\n` +
                 `- **Deadline:** ${grant.deadline || 'No deadline specified'}`,
        collection: 'grants',
        item: grant.id,
      });

      this.logger.info(`Grant ready notification sent to user ${userId} for grant ${grant.id}`);
      
    } catch (error) {
      this.logger.error(error, 'Error sending grant ready notification:');
    }
  }

  /**
   * Send notification to user that grant processing failed
   */
  private async notifyUserGrantFailed(userId: string, batchId: string, grantId?: string): Promise<void> {
    try {
      // Skip notification if no valid user ID
      if (!userId || userId === 'null' || userId === '') {
        this.logger.info(`Skipping grant failed notification - no valid user ID provided for batch ${batchId}`);
        return;
      }

      const notificationsService = new NotificationsService({
        schema: this.schema,
        accountability: this.accountability,
      });

      const message = grantId 
        ? `Unfortunately, we encountered an error while processing your grant documents (Batch: ${batchId}).\n\n` +
          `The grant has been created but the automatic extraction failed. You can manually edit the grant details.\n\n` +
          `[View Grant](/dashboard/admin/grants/${grantId})`
        : `Unfortunately, we encountered an error while processing your grant documents (Batch: ${batchId}).\n\n` +
          `Please try uploading the documents again or contact support if the issue persists.\n\n` +
          `[Upload New Grant](/dashboard/admin/grants/upload)`;

      await notificationsService.createOne({
        recipient: userId,
        subject: 'Grant processing failed',
        message,
      });

      this.logger.error(`Grant failed notification sent to user ${userId} for batch ${batchId}`);
      
    } catch (error) {
      this.logger.error(error, 'Error sending grant failed notification:');
    }
  }

  /**
   * Get the number of pending items in the grant extraction queue
   * Overrides the base implementation to use database instead of Redis
   */
  public override async getQueueSize(): Promise<number> {
    const knex = getDatabase();
    const result = await knex('grant_extraction_queue')
      .where('status', 'pending')
      .count('* as count');
    
    return parseInt(result[0]?.['count'] as string || '0');
  }

  /**
   * Required implementation of abstract method from BaseQueue
   */
  public async process(): Promise<void> {
    await this.processQueue();
  }
}