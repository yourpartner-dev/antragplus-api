import Joi from 'joi';

/**
 * Validation schemas for message voting endpoints
 */

// Schema for voting on a message
export const voteSchema = Joi.object({
  isUpvote: Joi.boolean().required(),
});

// Schema for getting vote statistics (query parameters)
export const getVoteStatsSchema = Joi.object({
  includeUserVote: Joi.boolean().default(true),
});
