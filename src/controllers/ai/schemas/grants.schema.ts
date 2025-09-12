import Joi from 'joi';

/**
 * Validation schemas for grant endpoints
 */

// Schema for processing grant documents
export const processGrantDocumentsSchema = Joi.object({
  file_ids: Joi.array()
    .items(Joi.string().uuid())
    .min(1)
    .required()
    .description('Array of file IDs to process for grant extraction'),
});