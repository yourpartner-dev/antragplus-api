import { useLogger } from '../helpers/logger/index.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';  // Fixed import - no destructuring

const logger = useLogger();

/**
 * AI-related collections that should be tracked
 */
const AI_COLLECTIONS = [
  'chats',
  'chat_messages',
  'documents',
  'document_suggestions',
  'message_votes'
];

/**
 * Map collection events to activity types
 */
const ACTIVITY_TYPE_MAP: Record<string, Record<string, string>> = {
  chats: {
    create: 'chat_created',
    update: 'chat_updated',
    delete: 'chat_deleted'
  },
  chat_messages: {
    create: 'message_sent',
    update: 'message_edited',
    delete: 'message_deleted'
  },
  documents: {
    create: 'document_created',
    update: 'document_updated',
    delete: 'document_deleted'
  },
  document_suggestions: {
    create: 'suggestion_generated',
    update: 'suggestion_resolved'
  },
  message_votes: {
    create: 'vote_cast',
    update: 'vote_updated',
    delete: 'vote_removed'
  }
};

/**
 * Log AI activity to ai_activity_logs table
 */
async function logAIActivity(
  collection: string,
  action: string,
  item: any,
  accountability: any
) {
  const knex = getDatabase();
  
  try {
    const activityType = ACTIVITY_TYPE_MAP[collection]?.[action];
    if (!activityType) return;

    const entityId = item.id || item.chat_message_id; // handle composite keys
    
    await knex('ai_activity_logs').insert({
      user_id: accountability?.user,
      activity_type: activityType,
      entity_type: collection,
      entity_id: entityId,
      description: `${activityType.replace('_', ' ')} for ${collection}`,
      metadata: {
        ...item,
        action,
        timestamp: new Date()
      },
      ip_address: accountability?.ip,
      user_agent: accountability?.userAgent,
      created_at: new Date()
    });

    logger.debug(`AI activity logged: ${activityType} for ${collection}/${entityId}`);
  } catch (error) {
    // Don't throw - logging should not break operations
    logger.error(error, 'Failed to log AI activity:');
  }
}

/**
 * Hook for tracking AI collection creates
 */
async function trackAICreate(meta: any, context: any) {
  const { collection, key, payload } = meta;  // Fixed: use key and payload
  const { accountability } = context;  // Fixed: get accountability from context
  if (!AI_COLLECTIONS.includes(collection)) return;
  
  const item = { id: key, ...payload };  // Reconstruct item from key and payload
  await logAIActivity(collection, 'create', item, accountability);
}

/**
 * Hook for tracking AI collection updates
 */
async function trackAIUpdate(meta: any, context: any) {
  const { collection, keys, payload } = meta;  // Fixed: use keys and payload
  const { accountability } = context;  // Fixed: get accountability from context
  if (!AI_COLLECTIONS.includes(collection)) return;
  
  // For updates, payload might be partial, so include the key
  const fullItem = { id: keys?.[0], ...payload };
  await logAIActivity(collection, 'update', fullItem, accountability);
}

/**
 * Hook for tracking AI collection deletes
 */
async function trackAIDelete(meta: any, context: any) {
  const { collection, keys } = meta;  // Fixed: removed accountability
  const { accountability } = context;  // Fixed: get accountability from context
  if (!AI_COLLECTIONS.includes(collection)) return;
  
  const item = { id: keys?.[0] };
  await logAIActivity(collection, 'delete', item, accountability);
}

/**
 * Register AI activity tracking hooks
 */
export function registerAIActivityHooks() {
  // Register hooks for each AI collection
  AI_COLLECTIONS.forEach(collection => {
    emitter.onAction(`${collection}.items.create`, trackAICreate);
    emitter.onAction(`${collection}.items.update`, trackAIUpdate);
    emitter.onAction(`${collection}.items.delete`, trackAIDelete);
  });

  logger.info('AI activity tracking hooks registered');
}

// Auto-register hooks when this module is imported
registerAIActivityHooks();