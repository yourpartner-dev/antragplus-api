import Joi from 'joi';

/**
 * Validation schemas for suggestions endpoints
 */

// Schema for accepting/rejecting a suggestion
export const resolveSuggestionSchema = Joi.object({
  resolution: Joi.string()
    .valid('accepted', 'rejected', 'modified')
    .required(),
});

// Schema for applying a suggestion
export const applySuggestionSchema = Joi.object({
  modifiedText: Joi.string().optional(), // If user modified the suggestion before applying
});

// Schema for listing suggestions
export const listSuggestionsSchema = Joi.object({
  document_id: Joi.string().uuid().optional(),
  resolved: Joi.boolean().optional(),
  type: Joi.string().valid('grammar', 'style', 'content', 'structure').optional(),
  created_by: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
  sort: Joi.string()
    .valid('created_at', '-created_at', 'confidence_score', '-confidence_score')
    .default('-created_at'),
});

// Schema for bulk resolving suggestions
export const bulkResolveSuggestionsSchema = Joi.object({
  suggestionIds: Joi.array()
    .items(Joi.string().uuid())
    .min(1)
    .max(100)
    .required(),
  resolution: Joi.string()
    .valid('accepted', 'rejected')
    .required(),
});

