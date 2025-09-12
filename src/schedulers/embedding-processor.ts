import { scheduleSynchronizedJob } from '../helpers/utils/schedule.js';
import { useLogger } from '../helpers/logger/index.js';
import { getSchema } from '../helpers/utils/get-schema.js';
import getDatabase from '../database/index.js';
import { QueueManager } from '../services/queues/queue-manager.js';

const logger = useLogger();

/**
 * Initialize the AI processor with scheduled jobs for Redis-based queues
 */
export function initializeEmbeddingProcessor() {
  // Process Redis embedding queue (every minute)
  const processEmbeddingQueueJob = scheduleSynchronizedJob(
    'process-embedding-queue',
    '* * * * *',
    processEmbeddingQueue
  );

  // Process Redis grant extraction queue (every minute)
  const processGrantExtractionQueueJob = scheduleSynchronizedJob(
    'process-grant-extraction-queue',
    '* * * * *',
    processGrantExtractionQueue
  );

  // Process Redis document parsing queue (every 30 seconds)
  const processDocumentParsingQueueJob = scheduleSynchronizedJob(
    'process-document-parsing-queue',
    '*/30 * * * * *',
    processDocumentParsingQueue
  );

  // Check for stale embeddings that need refresh (every hour)
  const refreshStaleEmbeddingsJob = scheduleSynchronizedJob(
    'refresh-stale-embeddings',
    '0 * * * *',
    refreshStaleEmbeddings
  );

  // Clean up orphaned embeddings (daily at 3 AM)
  const cleanupOrphanedJob = scheduleSynchronizedJob(
    'cleanup-orphaned-embeddings',
    '0 3 * * *',
    cleanupOrphanedEmbeddings
  );

  // Generate embeddings for new content without embeddings (every 15 minutes)
  const generateMissingJob = scheduleSynchronizedJob(
    'generate-missing-embeddings',
    '*/15 * * * *',
    generateMissingEmbeddings
  );

  logger.info('AI processor initialized with Redis-based queue schedulers (embedding, grant extraction, document parsing)');

  return {
    processEmbeddingQueueJob,
    processGrantExtractionQueueJob,
    processDocumentParsingQueueJob,
    refreshStaleEmbeddingsJob,
    cleanupOrphanedJob,
    generateMissingJob,
  };
}

/**
 * Process pending jobs from the Redis embedding queue
 */
async function processEmbeddingQueue() {
  try {
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, null);
    
    // Call the Redis-based queue's processQueue method
    await queueManager.getEmbeddingQueue().processQueue();
    
  } catch (error) {
    logger.error(error, 'Error processing embedding queue');
  }
}

/**
 * Process pending jobs from the Redis grant extraction queue
 */
async function processGrantExtractionQueue() {
  try {
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, null);
    
    // Call the Redis-based queue's processQueue method
    await queueManager.getGrantExtractionQueue().processQueue();
    
  } catch (error) {
    logger.error(error, 'Error processing grant extraction queue');
  }
}

/**
 * Process pending jobs from the Redis document parsing queue
 */
async function processDocumentParsingQueue() {
  try {
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, null);
    
    // Call the Redis-based queue's processQueue method
    await queueManager.getDocumentParsingQueue().processQueue();
    
  } catch (error) {
    logger.error(error, 'Error processing document parsing queue');
  }
}

/**
 * Queue embeddings for content that has been updated (add to Redis queues)
 */
async function refreshStaleEmbeddings() {
  logger.info('Checking for stale embeddings and queuing them...');

  try {
    const knex = getDatabase();
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, null);
    const embeddingQueue = queueManager.getEmbeddingQueue();

    // Tables to check for stale embeddings - only tables with updated_at columns
    // that can actually be "stale" (exclude reference/version tables)
    const tablesToCheck = [
      'ngos', 
      'grants', 
      'applications', 
      'application_content',
      'ngo_snippets', 
      'document_extracts',
      'extracted_data'
    ];

    for (const table of tablesToCheck) {
      try {
        // Find items where updated_at > last embedding update
        const query = knex(table)
          .select(`${table}.id`)
          .leftJoin(
            knex('embeddings')
              .select('source_id')
              .max('updated_at as last_embedded')
              .where('source_table', table)
              .groupBy('source_id')
              .as('e'),
            `${table}.id`,
            'e.source_id'
          )
          .where(function () {
            this.whereNull('e.last_embedded')
              .orWhere(`${table}.updated_at`, '>', knex.raw('e.last_embedded'));
          })
          .limit(50);

        const staleItems = await query;

        if (staleItems.length > 0) {
          logger.info(`Found ${staleItems.length} stale items in ${table}, adding to Redis queue`);

          // Add to Redis embedding queue
          await embeddingQueue.addEmbeddingJobs(
            staleItems.map(item => ({
              source_table: table,
              source_id: item.id,
              operation: 'update',
              priority: 5,
            }))
          );
        }
      } catch (error) {
        logger.error(error, `Error checking stale embeddings for ${table}`);
      }
    }

    logger.info('Stale embeddings check completed and queued to Redis');
  } catch (error) {
    logger.error(error, 'Error in refreshStaleEmbeddings:');
  }
}

/**
 * Clean up embeddings for deleted content
 */
async function cleanupOrphanedEmbeddings() {
  logger.info('Cleaning up orphaned embeddings...');

  try {
    const knex = getDatabase();
    const tablesToCheck = [
      'ngos', 
      'grants', 
      'applications', 
      'application_content',
      'application_content_versions', 
      'application_attachments',
      'grant_documents',
      'ngo_snippets', 
      'chat_messages',
      'document_extracts',
      'extracted_data'
    ];

    for (const table of tablesToCheck) {
      try {
        // Find embeddings where the source record no longer exists
        const orphanedEmbeddings = await knex('embeddings')
          .select('embeddings.source_id')
          .leftJoin(table, 'embeddings.source_id', `${table}.id`)
          .where('embeddings.source_table', table)
          .whereNull(`${table}.id`)
          .pluck('embeddings.source_id');

        if (orphanedEmbeddings.length > 0) {
          logger.info(`Found ${orphanedEmbeddings.length} orphaned embeddings for ${table}`);

          // Delete orphaned embeddings directly (no need to queue deletions)
          await knex('embeddings')
            .where('source_table', table)
            .whereIn('source_id', orphanedEmbeddings)
            .delete();
        }
      } catch (error) {
        logger.error(error, `Error cleaning orphaned embeddings for ${table}`);
      }
    }

    logger.info('Orphaned embeddings cleanup completed');
  } catch (error) {
    logger.error(error, 'Error in cleanupOrphanedEmbeddings');
  }
}

/**
 * Generate embeddings for content that doesn't have any (add to Redis queues)
 */
async function generateMissingEmbeddings() {
  logger.info('Checking for content missing embeddings and queuing them...');

  try {
    const knex = getDatabase();
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, null);
    const embeddingQueue = queueManager.getEmbeddingQueue();

    // All embeddable tables - including reference/version tables that need initial embeddings
    const tablesToCheck = [
      'ngos', 
      'grants', 
      'applications', 
      'application_content',
      'application_content_versions',
      'application_attachments', 
      'grant_documents',
      'ngo_snippets',
      'chat_messages',
      'document_extracts',
      'extracted_data'
    ];

    for (const table of tablesToCheck) {
      try {
        // Find items without any embeddings
        const itemsWithoutEmbeddings = await knex(table)
          .select(`${table}.id`)
          .leftJoin('embeddings', function () {
            this.on('embeddings.source_id', '=', `${table}.id`)
              .andOn('embeddings.source_table', '=', knex.raw('?', [table]));
          })
          .whereNull('embeddings.id')
          .limit(20)
          .pluck(`${table}.id`);

        if (itemsWithoutEmbeddings.length > 0) {
          logger.info(`Found ${itemsWithoutEmbeddings.length} items without embeddings in ${table}, adding to Redis queue`);

          // Add to Redis embedding queue
          await embeddingQueue.addEmbeddingJobs(
            itemsWithoutEmbeddings.map(itemId => ({
              source_table: table,
              source_id: itemId,
              operation: 'insert',
              priority: 7, // Lower priority for missing embeddings
            }))
          );
        }
      } catch (error) {
        logger.error(error, `Error checking missing embeddings for ${table}`);
      }
    }

    logger.info('Missing embeddings check completed and queued to Redis');
  } catch (error) {
    logger.error(error, 'Error in generateMissingEmbeddings');
  }
}

/**
 * Manually trigger embedding regeneration for specific items
 */
export async function regenerateEmbeddings(
  sourceTable: string,
  sourceIds: string[],
  priority: number = 3
): Promise<void> {
  const schema = await getSchema();
  const queueManager = new QueueManager(schema, null);
  const embeddingQueue = queueManager.getEmbeddingQueue();

  await embeddingQueue.addEmbeddingJobs(
    sourceIds.map(sourceId => ({
      source_table: sourceTable,
      source_id: sourceId,
      operation: 'update',
      priority,
    }))
  );

  logger.info(`Queued ${sourceIds.length} items for embedding regeneration in Redis`);
}