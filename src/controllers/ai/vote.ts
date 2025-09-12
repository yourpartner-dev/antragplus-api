import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { MessageVoteService } from '../../services/ai/messages/message-vote-service.js';
import { respond } from '../../middleware/respond.js';
import type { Request, Response } from 'express';
import { voteSchema, getVoteStatsSchema } from './schemas/vote.schema.js';
import { isValidUuid } from '../../helpers/utils/is-valid-uuid.js';
import { ForbiddenError, InvalidPayloadError } from '../../helpers/errors/index.js';

const router = express.Router();

/**
 * Vote on a message (upvote/downvote)
 */
router.post(
  '/:messageId/vote',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { messageId } = req.params;
    
    // Validate request body
    const { error, value } = voteSchema.validate(req.body);
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if(!messageId || !isValidUuid(messageId)) {
      throw new InvalidPayloadError({ reason: "Message ID not provided or not valid"});
    }

    const service = new MessageVoteService({
      accountability,
      schema,
    });

    const vote = await service.voteOnMessage(
      messageId,
      accountability.user,
      value.isUpvote
    );

    res.locals['payload'] = { data: vote };
    return next();
  }),
  respond
);

/**
 * Get vote status for a message
 */
router.get(
  '/:messageId/votes',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { messageId } = req.params;
    
    // Validate query parameters
    const { error } = getVoteStatsSchema.validate(req.query);
    
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    
    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if(!messageId || !isValidUuid(messageId)) {
      throw new InvalidPayloadError({ reason: "Message ID not provided or not valid"});
    }

    const service = new MessageVoteService({
      accountability,
      schema,
    });

    const voteStatus = await service.getVoteStatus(
      messageId,
      accountability?.user
    );

    res.locals['payload'] = { data: voteStatus };
    return next();
  }),
  respond
);

/**
 * Remove vote from a message
 */
router.delete(
  '/:messageId/vote',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { messageId } = req.params;
    
    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if(!messageId || !isValidUuid(messageId)) {
      throw new InvalidPayloadError({ reason: "Message ID not provided or not valid"});
    }

    const service = new MessageVoteService({
      accountability,
      schema,
    });

    await service.removeVote(
      messageId,
      accountability.user
    );

    res.locals['payload'] = { data: { success: true } };
    return next();
  }),
  respond
);

export default router;
