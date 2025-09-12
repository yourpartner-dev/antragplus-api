import { useLogger } from '../helpers/logger/index.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { getSchema } from '../helpers/utils/get-schema.js';
import { QueueManager } from '../services/queues/queue-manager.js';

const logger = useLogger();

/**
 * Tables that should have embeddings generated
 * CRITICAL: All content tables must be included for comprehensive AI search
 */
const EMBEDDABLE_TABLES = [
  'ngos',
  'grants', 
  'applications',
  'application_content', // Generated application content from AI
  'application_content_versions', // Version history of content  
  'application_attachments', // User-uploaded documents linked to applications
  'grant_documents', // Grant-related documents
  'ngo_snippets',
  'chat_messages',
  'document_extracts', // Parsed file content from uploaded documents
];

/**
 * Fields that trigger embedding regeneration when changed
 */
const EMBEDDING_TRIGGER_FIELDS: Record<string, string[]> = {
  ngos: ['about', 'field_of_work', 'funding_type', 'application_size'],
  grants: [
    'name',
    'description',
    'eligibility_criteria',
    'application_process',
    'evaluation_criteria',
    'reporting_requirements',
  ],
  applications: [
    'title',
    'project_title',
    'project_description',
    'problem_statement',
    'target_audience',
    'proposed_solution',
    'expected_outcomes',
  ],
  application_content: ['title', 'content'], // AI-generated application content
  application_content_versions: ['content'], // Version history content
  application_attachments: ['content'], // Direct text content in attachments
  grant_documents: ['metadata'], // Document metadata and descriptions
  ngo_snippets: ['title', 'content'],
  chat_messages: ['content'],
  document_extracts: ['content_text'], // Full parsed document text
};

/**
 * Queue embedding generation for created items
 */
export async function queueEmbeddingOnCreate(meta: any, context: any) {
  const { collection, key } = meta;
  if (!EMBEDDABLE_TABLES.includes(collection)) {
    return;
  }

  try {
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, context?.accountability || null);
    const embeddingQueue = queueManager.getEmbeddingQueue();
    
    await embeddingQueue.addEmbeddingJobs([{
      source_table: collection,
      source_id: key,
      operation: 'insert',
      priority: 5,
    }]);

    logger.info(`Queued embedding generation for new ${collection}:${key} in Redis`);
  } catch (error) {
    logger.error(error, `Error queuing embedding for ${collection}:${key}`);
  }
}

/**
 * Queue embedding update for modified items
 */
export async function queueEmbeddingOnUpdate(meta: any, context: any) {
  const { collection, keys, payload } = meta;
  if (!EMBEDDABLE_TABLES.includes(collection)) {
    return;
  }

  try {
    const triggerFields = EMBEDDING_TRIGGER_FIELDS[collection] || [];
    const changedFields = Object.keys(payload);
    
    // Check if any embedding-relevant fields were changed
    const shouldUpdateEmbedding = changedFields.some(field => 
      triggerFields.includes(field)
    );

    if (!shouldUpdateEmbedding) {
      return;
    }

    const schema = await getSchema();
    const queueManager = new QueueManager(schema, context?.accountability || null);
    const embeddingQueue = queueManager.getEmbeddingQueue();
    
    // Queue updates for all affected items
    const jobs = keys.map((key: string) => ({
      source_table: collection,
      source_id: key,
      operation: 'update' as const,
      priority: 5,
    }));
    
    await embeddingQueue.addEmbeddingJobs(jobs);

    logger.info(`Queued embedding update for ${keys.length} ${collection} items in Redis`);
  } catch (error) {
    logger.error(error, `Error queuing embedding update for ${collection}`);
  }
}

/**
 * Queue embedding deletion for removed items
 */
export async function queueEmbeddingOnDelete(meta: any, context: any) {
  const { collection, keys } = meta;
  if (!EMBEDDABLE_TABLES.includes(collection)) {
    return;
  }

  try {
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, context?.accountability || null);
    const embeddingQueue = queueManager.getEmbeddingQueue();
    
    // Queue deletions for all affected items
    const jobs = keys.map((key: string) => ({
      source_table: collection,
      source_id: key,
      operation: 'delete' as const,
      priority: 3, // Higher priority for deletions
    }));
    
    await embeddingQueue.addEmbeddingJobs(jobs);

    logger.info(`Queued embedding deletion for ${keys.length} ${collection} items in Redis`);
  } catch (error) {
    logger.error(error, `Error queuing embedding deletion for ${collection}`);
  }
}

/**
 * Special handling for file uploads that contain documents
 */
export async function queueEmbeddingForFileUpload(meta: any, context: any) {
  const { key, collection } = meta;
  if (collection !== 'yp_files') {
    return;
  }

  try {
    // Check if this file is referenced by any embeddable content
    const knex = getDatabase();
    const schema = await getSchema();
    const queueManager = new QueueManager(schema, context?.accountability || null);
    const embeddingQueue = queueManager.getEmbeddingQueue();
    
    const jobsToQueue = [];
    
    // Check application_attachments
    const appAttachments = await knex('application_attachments')
      .where('file_id', key)
      .first();
      
    if (appAttachments) {
      jobsToQueue.push({
        source_table: 'application_attachments',
        source_id: appAttachments.id,
        operation: 'update' as const,
        priority: 5,
      });
    }

    // Check grant_documents
    const grantDocs = await knex('grant_documents')
      .where('file_id', key)
      .first();
      
    if (grantDocs) {
      jobsToQueue.push({
        source_table: 'grant_documents',
        source_id: grantDocs.id,
        operation: 'update' as const,
        priority: 5,
      });
    }

    // Queue all jobs at once if any found
    if (jobsToQueue.length > 0) {
      await embeddingQueue.addEmbeddingJobs(jobsToQueue);
      logger.info(`Queued ${jobsToQueue.length} embedding jobs for file upload ${key} in Redis`);
    }

  } catch (error) {
    logger.error(error, `Error processing file upload for embeddings`);
  }
}

/**
 * Register all embedding hooks
 */
export function registerEmbeddingHooks() {
  // Register general item hooks
  emitter.onAction('items.create', queueEmbeddingOnCreate);
  emitter.onAction('items.update', queueEmbeddingOnUpdate);
  emitter.onAction('items.delete', queueEmbeddingOnDelete);
  
  // Register file upload hook
  emitter.onAction('files.upload', queueEmbeddingForFileUpload);
  
  logger.info('Embedding generation hooks registered');
}

// Auto-register hooks when this module is imported
registerEmbeddingHooks();

/**
 * Utility function to manually trigger embedding for specific items
 */
export async function triggerEmbedding(
  sourceTable: string,
  sourceId: string,
  operation: 'insert' | 'update' | 'delete' = 'update',
  priority: number = 5
): Promise<void> {
  const knex = getDatabase();
  
  await knex('embedding_queue').insert({
    source_table: sourceTable,
    source_id: sourceId,
    operation,
    priority,
    status: 'pending',
    created_at: new Date(),
  }).onConflict(['source_table', 'source_id', 'operation']).merge({
    priority: knex.raw('LEAST(priority, ?)', [priority]),
    status: 'pending',
    retry_count: 0,
    created_at: new Date(),
  });
  
  logger.info(`Manually triggered embedding for ${sourceTable}:${sourceId}`);
}
