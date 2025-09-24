import { scheduleSynchronizedJob } from '../helpers/utils/schedule.js';
import { useLogger } from '../helpers/logger/index.js';
import { getSchema } from '../helpers/utils/get-schema.js';
import getDatabase from '../database/index.js';
import { QueueManager } from '../services/queues/queue-manager.js';
import { GrantMatchService } from '../services/ai/matching/grant-match-service.js';

const logger = useLogger();

/**
 * Initialize the AI processor with scheduled jobs for Redis-based queues
 */
export function initializeEmbeddingProcessor() {
  // Process Redis embedding queue (every 3 minutes to reduce load)
  const processEmbeddingQueueJob = scheduleSynchronizedJob(
    'process-embedding-queue',
    '*/3 * * * *',
    processEmbeddingQueue
  );

  // Process Redis grant extraction queue (every 5 minutes to reduce load)
  const processGrantExtractionQueueJob = scheduleSynchronizedJob(
    'process-grant-extraction-queue',
    '*/5 * * * *',
    processGrantExtractionQueue
  );

  // Process Redis document parsing queue (every 2 minutes to reduce load)
  const processDocumentParsingQueueJob = scheduleSynchronizedJob(
    'process-document-parsing-queue',
    '*/2 * * * *',
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

  // Process grant matching for new grants (every 30 minutes)
  const processNewGrantMatchesJob = scheduleSynchronizedJob(
    'process-new-grant-matches',
    '*/30 * * * *',
    processNewGrantMatches
  );

  // Process recently updated grants (every 2 hours)
  const processUpdatedGrantMatchesJob = scheduleSynchronizedJob(
    'process-updated-grant-matches',
    '0 */2 * * *',
    processUpdatedGrantMatches
  );

  // Process new NGOs (every 45 minutes, offset from grant processing)
  const processNewNGOMatchesJob = scheduleSynchronizedJob(
    'process-new-ngo-matches',
    '15,45 * * * *',
    processNewNGOMatches
  );

  // Refresh expiring grant matches (daily at 2 AM)
  const refreshExpiringMatchesJob = scheduleSynchronizedJob(
    'refresh-expiring-matches',
    '0 2 * * *',
    refreshExpiringMatches
  );

  // Clean up expired grant matches (daily at 4 AM)
  const cleanupExpiredMatchesJob = scheduleSynchronizedJob(
    'cleanup-expired-matches',
    '0 4 * * *',
    cleanupExpiredMatches
  );

  logger.info('AI processor initialized with Redis-based queue schedulers (embedding, grant extraction, document parsing, grant matching)');

  return {
    processEmbeddingQueueJob,
    processGrantExtractionQueueJob,
    processDocumentParsingQueueJob,
    refreshStaleEmbeddingsJob,
    cleanupOrphanedJob,
    generateMissingJob,
    processNewGrantMatchesJob,
    processUpdatedGrantMatchesJob,
    processNewNGOMatchesJob,
    refreshExpiringMatchesJob,
    cleanupExpiredMatchesJob,
  };
}

/**
 * Process pending jobs from the Redis embedding queue
 */
async function processEmbeddingQueue() {
  // Check memory usage before processing
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

  if (heapUsedMB > 6000) { // Alert if using more than 6GB
    logger.warn(`High memory usage detected: ${heapUsedMB}MB/${heapTotalMB}MB. Skipping embedding queue processing.`);
    return;
  }

  try {
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, null);

    // Call the Redis-based queue's processQueue method
    await queueManager.getEmbeddingQueue().processQueue();

    // Log memory usage after processing
    const memUsageAfter = process.memoryUsage();
    const heapUsedAfterMB = Math.round(memUsageAfter.heapUsed / 1024 / 1024);
    if (heapUsedAfterMB > heapUsedMB + 500) { // Alert if memory increased by 500MB
      logger.warn(`Memory usage increased significantly: ${heapUsedMB}MB -> ${heapUsedAfterMB}MB`);
    }

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

/**
 * Process grant matching for new grants that don't have matches yet
 */
async function processNewGrantMatches() {
  logger.info('Processing grant matches for new grants...');

  try {
    const knex = getDatabase();
    const grantMatchService = new GrantMatchService();

    // Find grants that don't have matches yet and are still active
    const newGrants = await knex('grants')
      .select('grants.id')
      .leftJoin('grant_matches', 'grants.id', 'grant_matches.grant_id')
      .where('grants.status', 'active')
      .where(function() {
        this.where('grants.deadline', '>', knex.fn.now())
          .orWhereNull('grants.deadline');
      })
      .whereNull('grant_matches.grant_id')
      .orderBy('grants.created_at', 'desc')
      .limit(5); // Process maximum 5 new grants per run

    logger.info(`Found ${newGrants.length} grants without matches`);

    for (const grant of newGrants) {
      try {
        const result = await grantMatchService.analyzeGrantMatches(grant.id);
        logger.info(`Processed matches for grant ${grant.id}: ${result.matches_processed} matches analyzed`);

        // Small delay between grants to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.error(error, `Error processing matches for grant ${grant.id}`);
      }
    }

    logger.info('New grant matches processing completed');
  } catch (error) {
    logger.error(error, 'Error processing new grant matches');
  }
}

/**
 * Process grant matching for recently updated grants that have existing matches
 */
async function processUpdatedGrantMatches() {
  logger.info('Processing grant matches for recently updated grants...');

  try {
    const knex = getDatabase();
    const grantMatchService = new GrantMatchService();

    // Find grants updated in last 24 hours that have existing matches
    const updatedGrants = await knex('grants')
      .select('grants.id')
      .join('grant_matches', 'grants.id', 'grant_matches.grant_id')
      .where('grants.status', 'active')
      .where('grants.updated_at', '>', knex.raw('NOW() - INTERVAL \'24 hours\''))
      .where('grant_matches.match_status', 'active')
      .where(function() {
        this.where('grants.deadline', '>', knex.fn.now())
          .orWhereNull('grants.deadline');
      })
      .groupBy('grants.id')
      .orderBy('grants.updated_at', 'desc')
      .limit(10); // Process maximum 10 updated grants per run

    logger.info(`Found ${updatedGrants.length} recently updated grants with existing matches`);

    for (const grant of updatedGrants) {
      try {
        const result = await grantMatchService.analyzeGrantMatches(grant.id);
        logger.info(`Re-processed matches for updated grant ${grant.id}: ${result.matches_processed} matches refreshed`);

        // Small delay between grants to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        logger.error(error, `Error re-processing matches for updated grant ${grant.id}`);
      }
    }

    logger.info('Updated grant matches processing completed');
  } catch (error) {
    logger.error(error, 'Error processing updated grant matches');
  }
}

/**
 * Process grant matching for new NGOs that don't have matches yet
 */
async function processNewNGOMatches() {
  logger.info('Processing grant matches for new NGOs...');

  try {
    const knex = getDatabase();
    const grantMatchService = new GrantMatchService();

    // Find NGOs that don't have matches yet
    const newNGOs = await knex('ngos')
      .select('ngos.id')
      .leftJoin('grant_matches', 'ngos.id', 'grant_matches.ngo_id')
      .whereNull('grant_matches.ngo_id')
      .orderBy('ngos.created_at', 'desc')
      .limit(3); // Process maximum 3 new NGOs per run (they match against many grants)

    logger.info(`Found ${newNGOs.length} NGOs without matches`);

    for (const ngo of newNGOs) {
      try {
        const result = await grantMatchService.analyzeNGOMatches(ngo.id);
        logger.info(`Processed matches for NGO ${ngo.id}: ${result.matches_processed} grants analyzed`);

        // Longer delay between NGOs since each NGO analyzes against many grants
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        logger.error(error, `Error processing matches for NGO ${ngo.id}`);
      }
    }

    logger.info('New NGO matches processing completed');
  } catch (error) {
    logger.error(error, 'Error processing new NGO matches');
  }
}

/**
 * Refresh grant matches that are expiring soon
 */
async function refreshExpiringMatches() {
  logger.info('Refreshing expiring grant matches...');

  try {
    const knex = getDatabase();
    const grantMatchService = new GrantMatchService();

    // Find matches expiring in the next 7 days
    const expiringMatches = await knex('grant_matches')
      .select('grant_matches.ngo_id', 'grant_matches.grant_id')
      .join('grants', 'grant_matches.grant_id', 'grants.id')
      .where('grant_matches.match_status', 'active')
      .where('grant_matches.expires_at', '>', knex.fn.now())
      .where('grant_matches.expires_at', '<', knex.raw('NOW() + INTERVAL \'7 days\''))
      .where('grants.status', 'active')
      .orderBy('grant_matches.expires_at', 'asc')
      .limit(20); // Process maximum 20 expiring matches per run

    logger.info(`Found ${expiringMatches.length} expiring matches to refresh`);

    for (const match of expiringMatches) {
      try {
        await grantMatchService.analyzeMatch(match.ngo_id, match.grant_id);
        logger.info(`Refreshed match: NGO ${match.ngo_id} <-> Grant ${match.grant_id}`);

        // Small delay between matches
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(error, `Error refreshing match ${match.ngo_id}/${match.grant_id}`);
      }
    }

    logger.info('Expiring matches refresh completed');
  } catch (error) {
    logger.error(error, 'Error refreshing expiring matches');
  }
}

/**
 * Clean up expired grant matches
 */
async function cleanupExpiredMatches() {
  logger.info('Cleaning up expired grant matches...');

  try {
    const knex = getDatabase();

    // Update expired matches to 'expired' status instead of deleting
    const expiredCount = await knex('grant_matches')
      .where('match_status', 'active')
      .where('expires_at', '<', knex.fn.now())
      .update({
        match_status: 'expired',
        updated_at: new Date()
      });

    logger.info(`Marked ${expiredCount} grant matches as expired`);

    // Optionally delete very old expired matches (older than 6 months)
    const deletedCount = await knex('grant_matches')
      .where('match_status', 'expired')
      .where('expires_at', '<', knex.raw('NOW() - INTERVAL \'6 months\''))
      .delete();

    if (deletedCount > 0) {
      logger.info(`Deleted ${deletedCount} old expired grant matches`);
    }

    logger.info('Expired matches cleanup completed');
  } catch (error) {
    logger.error(error, 'Error cleaning up expired matches');
  }
}