import Joi from 'joi';

/**
 * Validation schemas for history endpoints
 */

// Schema for getting user history
export const getUserHistorySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(500).default(50),
  offset: Joi.number().integer().min(0).default(0),
  activity_type: Joi.string()
    .valid(
      'create', 'update', 'delete', 'view', 'download',
      'chat_created', 'document_created', 'application_submitted',
      'grant_matched', 'suggestion_applied'
    )
    .optional(),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  entity_type: Joi.string()
    .valid('ngos', 'grants', 'applications', 'documents', 'chats', 'snippets')
    .optional(),
  entity_id: Joi.string().uuid().optional(),
}).custom((value, helpers) => {
  // Validate date range
  if (value.start_date && value.end_date) {
    if (new Date(value.start_date) > new Date(value.end_date)) {
      return helpers.error('any.invalid', { message: 'start_date must be before end_date' });
    }
  }
  return value;
});

// Schema for exporting history
export const exportHistorySchema = Joi.object({
  format: Joi.string().valid('json', 'csv').default('json'),
  start_date: Joi.date().iso().optional(),
  end_date: Joi.date().iso().optional(),
  activity_type: Joi.string()
    .valid(
      'create', 'update', 'delete', 'view', 'download',
      'chat_created', 'document_created', 'application_submitted',
      'grant_matched', 'suggestion_applied'
    )
    .optional(),
  include_metadata: Joi.boolean().default(false),
}).custom((value, helpers) => {
  // Validate date range
  if (value.start_date && value.end_date) {
    if (new Date(value.start_date) > new Date(value.end_date)) {
      return helpers.error('any.invalid', { message: 'start_date must be before end_date' });
    }
    // Limit export range to 1 year
    const daysDiff = (new Date(value.end_date).getTime() - new Date(value.start_date).getTime()) / (1000 * 3600 * 24);
    if (daysDiff > 365) {
      return helpers.error('any.invalid', { message: 'Export date range cannot exceed 365 days' });
    }
  }
  return value;
});

// Schema for getting activity summary
export const getActivitySummarySchema = Joi.object({
  period: Joi.string()
    .valid('day', 'week', 'month', 'year')
    .default('week'),
});

// Schema for getting recent activities
export const getRecentActivitiesSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(50).default(10),
});
