import Joi from "joi";

// Schema for creating content version
export const createContentVersionSchema = Joi.object({
  application_id: Joi.string().uuid().required(),
  content_id: Joi.string().uuid().required(),
  change_description: Joi.string().optional(),
  content: Joi.string().optional(),
  content_blocks: Joi.string().optional(),
});