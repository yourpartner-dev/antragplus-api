import { useLogger } from '../helpers/logger/index.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { getSchema } from '../helpers/utils/get-schema.js';
import { QueueManager } from '../services/queues/queue-manager.js';
import { SUPPORTED_DOCUMENT_TYPES } from '../services/files/lib/document-parser.js';

const logger = useLogger();

/**
 * Hook to trigger document parsing when files are uploaded
 */
export async function parseDocumentOnUpload(meta: any, context: any) {
  const { key, payload, collection } = meta;
  
  // Only process files uploads (files.upload doesn't have collection, it's implicit)
  // For files.upload event, collection is undefined, so we process all
  if (collection && collection !== 'yp_files') {
    return;
  }

  try {
    // Check if the file type is supported for parsing
    const mimeType = payload.type;
    if (!mimeType || !SUPPORTED_DOCUMENT_TYPES.includes(mimeType)) {
      logger.debug(`File type ${mimeType} not supported for parsing, skipping file ${key}`);
      return;
    }

    // Get file details from database
    const knex = getDatabase();
    const file = await knex('yp_files')
      .where('id', key)
      .first();

    if (!file) {
      logger.warn(`File ${key} not found after upload`);
      return;
    }

    // Add document to Redis DocumentParsingQueue
    logger.info(`Adding document ${key} to Redis parsing queue - type: ${mimeType}`);
    
    try {
      const schema = await getSchema();
      const queueManager = new QueueManager(schema, context?.accountability || null);
      const documentParsingQueue = queueManager.getDocumentParsingQueue();
      
      await documentParsingQueue.addDocumentParsingJobs([{
        file_id: key,
        storage_location: file.storage || 'local',
        filename_disk: file.filename_disk,
        mime_type: file.type,
        user_id: context?.accountability?.user
      }]);
      
      logger.info(`Successfully queued document ${key} for parsing in Redis`);
    } catch (queueError) {
      logger.error(queueError, `Error adding document ${key} to parsing queue:`);
    }
  } catch (error) {
    logger.error(error, `Error in document parsing hook for file ${key}`);
    // Don't throw - parsing failure shouldn't break file upload
  }
}

/**
 * Hook to remove document extracts when files are deleted
 */
export async function removeExtractsOnDelete(meta: any, _context: any) {
  const { keys, collection } = meta;
  
  if (collection !== 'yp_files') {
    return;
  }

  try {
    const knex = getDatabase();
    
    // Delete document extracts for deleted files
    // Cascade delete should handle this, but being explicit
    const deleted = await knex('document_extracts')
      .whereIn('file_id', keys)
      .delete();
    
    if (deleted > 0) {
      logger.info(`Removed ${deleted} document extracts for deleted files`);
    }
  } catch (error) {
    logger.error(error, 'Error removing document extracts');
  }
}

/**
 * Hook to reparse documents when files are updated/replaced
 */
export async function reparseDocumentOnUpdate(meta: any, context: any) {
  const { keys, payload, collection } = meta;
  
  if (collection !== 'yp_files') {
    return;
  }

  // Only reparse if the file content might have changed
  if (!payload.filename_disk && !payload.type) {
    return;
  }

  try {
    for (const fileId of keys) {
      // Trigger reparsing similar to upload
      const knex = getDatabase();
      const file = await knex('yp_files')
        .where('id', fileId)
        .first();

      if (!file || !SUPPORTED_DOCUMENT_TYPES.includes(file.type)) {
        continue;
      }

      logger.info(`Re-queuing updated document ${fileId} for parsing`);
      
      try {
        const schema = await getSchema();
        const queueManager = new QueueManager(schema, context?.accountability || null);
        const documentParsingQueue = queueManager.getDocumentParsingQueue();
        
        await documentParsingQueue.addDocumentParsingJobs([{
          file_id: fileId,
          storage_location: file.storage || 'local',
          filename_disk: file.filename_disk,
          mime_type: file.type,
          user_id: context?.accountability?.user
        }]);
        
        logger.info(`Successfully re-queued document ${fileId} for parsing in Redis`);
      } catch (queueError) {
        logger.error(queueError, `Error re-queuing document ${fileId} for parsing`);
      }
    }
  } catch (error) {
    logger.error(error, 'Error reparsing documents on update:');
  }
}

/**
 * Register document parsing hooks
 */
export function registerDocumentParsingHooks() {
  // Listen for file uploads (main trigger)
  emitter.onAction('files.upload', parseDocumentOnUpload);
  
  // Also listen for direct yp_files creation (backup trigger)
  emitter.onAction('yp_files.items.create', parseDocumentOnUpload);
  
  // Listen for file updates/replacements
  emitter.onAction('yp_files.items.update', reparseDocumentOnUpdate);
  
  // Listen for file deletions (though cascade should handle)
  emitter.onAction('yp_files.items.delete', removeExtractsOnDelete);
  
  logger.info('Document parsing hooks registered');
}

// Auto-register hooks when this module is imported
registerDocumentParsingHooks();