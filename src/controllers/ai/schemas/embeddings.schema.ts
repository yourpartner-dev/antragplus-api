import Joi from 'joi';

/**
 * Validation schemas for embedding endpoints
 */

// Schema for semantic search
export const searchSchema = Joi.object({
  query: Joi.string().min(1).max(1000).required(),
  options: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(10),
    threshold: Joi.number().min(0).max(1).default(0.7),
    filter: Joi.object({
      source_table: Joi.string()
        .valid('ngos', 'grants', 'applications', 'documents', 'chat_messages', 'ngo_snippets')
        .optional(),
      ngo_id: Joi.string().uuid().optional(),
      grant_id: Joi.string().uuid().optional(),
      application_id: Joi.string().uuid().optional(),
      language: Joi.string().min(2).max(5).optional(),
    }).optional(),
    includeMetadata: Joi.boolean().default(true),
  }).default({}),
});

// Schema for building context
export const buildContextSchema = Joi.object({
  query: Joi.string().min(1).max(1000).required(),
  chatId: Joi.string().uuid().optional(),
  options: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(20),
    threshold: Joi.number().min(0).max(1).default(0.65),
    filter: Joi.object({
      source_table: Joi.array()
        .items(Joi.string().valid('ngos', 'grants', 'applications', 'documents', 'chat_messages', 'ngo_snippets'))
        .optional(),
      ngo_id: Joi.string().uuid().optional(),
      grant_id: Joi.string().uuid().optional(),
      application_id: Joi.string().uuid().optional(),
      language: Joi.string().min(2).max(5).optional(),
      date_range: Joi.object({
        start: Joi.date().iso().optional(),
        end: Joi.date().iso().optional(),
      }).optional(),
    }).optional(),
    includeMetadata: Joi.boolean().default(true),
    cacheResults: Joi.boolean().default(true),
    cacheDuration: Joi.number().integer().min(60).max(86400).default(3600), // 1 hour default, max 24 hours
  }).default({}),
});

// Schema for queueing embeddings
export const queueEmbeddingSchema = Joi.object({
  source_table: Joi.string()
    .valid('ngos', 'grants', 'applications', 'documents', 'chat_messages', 'ngo_snippets')
    .required(),
  source_id: Joi.string().uuid().required(),
  operation: Joi.string().valid('insert', 'update', 'delete').default('update'),
  priority: Joi.number().integer().min(1).max(10).default(5),
});

// Schema for batch queueing embeddings
export const batchQueueEmbeddingSchema = Joi.object({
  items: Joi.array()
    .items(
      Joi.object({
        source_table: Joi.string()
          .valid('ngos', 'grants', 'applications', 'documents', 'chat_messages', 'ngo_snippets')
          .required(),
        source_id: Joi.string().uuid().required(),
        operation: Joi.string().valid('insert', 'update', 'delete').default('update'),
        priority: Joi.number().integer().min(1).max(10).default(5),
      })
    )
    .min(1)
    .max(100)
    .required(),
});
