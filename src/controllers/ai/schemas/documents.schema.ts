import Joi from 'joi';

/**
 * Validation schemas for document endpoints
 */

// Schema for creating a document
export const createDocumentSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  content: Joi.string().allow('').optional(),
  content_format: Joi.string().valid('text', 'markdown', 'json', 'html').default('text'),
  kind: Joi.string().valid('text', 'code', 'image', 'sheet').default('text'),
  ngo_id: Joi.string().uuid().optional(),
  application_id: Joi.string().uuid().optional(),
  metadata: Joi.object().optional(),
});

// Schema for updating a document
export const updateDocumentSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  content: Joi.string().optional(),
  content_format: Joi.string().valid('text', 'markdown', 'json', 'html').optional(),
  kind: Joi.string().valid('text', 'code', 'image', 'sheet').optional(),
  metadata: Joi.object().optional(),
}).min(1); // At least one field must be provided

// Schema for listing documents
export const listDocumentsSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  sort: Joi.string().valid('created_at', '-created_at', 'updated_at', '-updated_at', 'title', '-title').default('-created_at'),
  filter: Joi.object({
    ngo_id: Joi.string().uuid().optional(),
    application_id: Joi.string().uuid().optional(),
    kind: Joi.string().valid('text', 'code', 'image', 'sheet').optional(),
    content_format: Joi.string().valid('text', 'markdown', 'json', 'html').optional(),
    created_by: Joi.string().uuid().optional(),
  }).optional(),
});

// Schema for creating a document version
export const createDocumentVersionSchema = Joi.object({
  content: Joi.string().required(),
  changes: Joi.object({
    summary: Joi.string().optional(),
    added: Joi.number().integer().min(0).optional(),
    deleted: Joi.number().integer().min(0).optional(),
    modified: Joi.number().integer().min(0).optional(),
  }).optional(),
});

// Schema for generating suggestions
export const generateSuggestionsSchema = Joi.object({
  type: Joi.string()
    .valid('all', 'grammar', 'style', 'content', 'structure')
    .default('all'),
  context: Joi.object({
    target_audience: Joi.string().optional(),
    tone: Joi.string().valid('formal', 'informal', 'professional', 'friendly').optional(),
    purpose: Joi.string().optional(),
  }).optional(),
});

// Schema for getting suggestions
export const getSuggestionsSchema = Joi.object({
  resolved: Joi.boolean().optional(),
  type: Joi.string().valid('grammar', 'style', 'content', 'structure').optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});
