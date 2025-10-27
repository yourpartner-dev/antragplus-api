import Joi from 'joi';

/**
 * Validation schemas for chat endpoints
 */

// Schema for creating a new chat
export const createChatSchema = Joi.object({
  messages: Joi.array()
    .items(
      Joi.object({
        role: Joi.string().valid('user', 'assistant', 'system').required(),
        content: Joi.string().required(),
      })
    )
    .min(1)
    .required(),
  context: Joi.object({
    ngo_id: Joi.string().uuid().optional(),
    grant_id: Joi.string().uuid().optional(),
    application_id: Joi.string().uuid().optional(),
    context_type: Joi.string()
      .valid('application_edit', 'ngo_onboarding', 'grant_discovery', 'document_generation')
      .optional(),
  }).optional(),
  temperature: Joi.number().min(0).max(2).optional(),
  ephemeral_context: Joi.object({
    current_document: Joi.object({
      id: Joi.string().uuid().required(),
      title: Joi.string().required(),
      kind: Joi.string().optional()
    }).optional()
  }).optional(),
});

// Schema for updating a chat
export const updateChatSchema = Joi.object({
  title: Joi.string().min(1).max(255).optional(),
  status: Joi.string().valid('active', 'archived', 'deleted').optional(),
  visibility: Joi.string().valid('private', 'organization', 'public').optional(),
  metadata: Joi.object().optional(),
});

// Schema for adding a message to a chat
export const addMessageSchema = Joi.object({
  content: Joi.string().required(),
  role: Joi.string().valid('user', 'assistant').optional().default('user'),
  attachments: Joi.array()
    .items(
      Joi.object({
        file_id: Joi.string().uuid().optional(),
        url: Joi.string().uri().optional(),
        name: Joi.string().optional(),
        type: Joi.string().optional(),
        size: Joi.number().optional(),
      })
    )
    .optional(),
  context_type: Joi.string()
    .valid('application_edit', 'ngo_onboarding', 'grant_discovery', 'document_generation')
    .optional(),
  metadata: Joi.object().optional(),
});

// Schema for listing chats
export const listChatsSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  offset: Joi.number().integer().min(0).default(0),
  sort: Joi.string().valid('created_at', '-created_at', 'updated_at', '-updated_at').default('-created_at'),
  filter: Joi.object({
    status: Joi.string().valid('active', 'archived', 'deleted').optional(),
    context_type: Joi.string()
      .valid('application_edit', 'ngo_onboarding', 'grant_discovery', 'document_generation')
      .optional(),
    ngo_id: Joi.string().uuid().optional(),
    grant_id: Joi.string().uuid().optional(),
    application_id: Joi.string().uuid().optional(),
  }).optional(),
});

// Schema for getting messages
export const getMessagesSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
  order: Joi.string().valid('asc', 'desc').default('asc'),
});

// Schema for accepting inline rewrite suggestions
// Note: original_text should be the MARKDOWN substring (not plain text)
// Frontend extracts markdown substring, backend does exact string replacement
export const acceptRewriteSchema = Joi.object({
  document_id: Joi.string().uuid().required(),
  original_text: Joi.string().min(1).required().description('Markdown substring from document source'),
  suggested_text: Joi.string().min(1).required().description('Plain text replacement (AI-generated)'),
  chat_id: Joi.string().uuid().optional().description('For audit trail'),
  change_description: Joi.string().optional(),
});