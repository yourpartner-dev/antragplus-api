import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { SuggestionService } from '../../services/ai/suggestions/suggestion-service.js';
import { respond } from '../../middleware/respond.js';
import type { Request, Response } from 'express';
import {
  resolveSuggestionSchema,
  applySuggestionSchema,
  listSuggestionsSchema,
  bulkResolveSuggestionsSchema,
} from './schemas/suggestions.schema.js';
import { ForbiddenError, InvalidPayloadError } from '../../helpers/errors/index.js';
import { isValidUuid } from '../../helpers/utils/is-valid-uuid.js';

const router = express.Router();

/**
 * Accept or reject a suggestion
 */
router.patch(
  '/:suggestionId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { suggestionId } = req.params;
    
    // Validate request body
    const { error, value } = resolveSuggestionSchema.validate(req.body);
    
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if(!suggestionId || !isValidUuid(suggestionId)) {
      throw new InvalidPayloadError({ reason: "Suggestion ID not provided or not valid"});
    }

    const service = new SuggestionService({
      accountability,
      schema,
    });

    const updatedSuggestion = await service.resolveSuggestion(
      suggestionId,
      value.resolution,
      accountability.user
    );

    if (!updatedSuggestion) {
      return res.status(404).json({
        errors: [{ message: 'Suggestion not found' }],
      });
    }

    res.locals['payload'] = { data: updatedSuggestion };
    return next();
  }),
  respond
);

/**
 * Apply a suggestion to the document
 */
router.post(
  '/:suggestionId/apply',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { suggestionId } = req.params;
    
    // Validate request body
    const { error, value } = applySuggestionSchema.validate(req.body);
    
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if(!suggestionId || !isValidUuid(suggestionId)) {
      throw new InvalidPayloadError({ reason: "Suggestion ID not provided or not valid"});
    }

    const service = new SuggestionService({
      accountability,
      schema,
    });

    const result = await service.applySuggestion(
      suggestionId,
      accountability.user,
      value.modifiedText
    );

    if (!result) {
      return res.status(404).json({
        errors: [{ message: 'Suggestion not found or already applied' }],
      });
    }

    res.locals['payload'] = { data: result };
    return next();
  }),
  respond
);

/**
 * Get all suggestions with optional filters
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response, next) => {
    // Validate query parameters
    const { error, value } = listSuggestionsSchema.validate(req.query);
    
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    const service = new SuggestionService({
      accountability,
      schema,
    });

    const suggestions = await service.getSuggestions(value);

    res.locals['payload'] = { data: suggestions };
    return next();
  }),
  respond
);

/**
 * Get a specific suggestion
 */
router.get(
  '/:suggestionId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { suggestionId } = req.params;
    
    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    if(!suggestionId || !isValidUuid(suggestionId)) {
      throw new InvalidPayloadError({ reason: "Suggestion ID not provided or not valid"});
    }

    const service = new SuggestionService({
      accountability,
      schema,
    });

    const suggestion = await service.getSuggestion(suggestionId);

    if (!suggestion) {
      return res.status(404).json({
        errors: [{ message: 'Suggestion not found' }],
      });
    }

    res.locals['payload'] = { data: suggestion };
    return next();
  }),
  respond
);

/**
 * Bulk accept/reject suggestions
 */
router.post(
  '/bulk-resolve',
  asyncHandler(async (req: Request, res: Response, next) => {
    // Validate request body
    const { error, value } = bulkResolveSuggestionsSchema.validate(req.body);
    
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      throw new ForbiddenError();
    }

    const service = new SuggestionService({
      accountability,
      schema,
    });

    const results = await service.bulkResolveSuggestions(
      value.suggestionIds,
      value.resolution,
      accountability.user
    );

    res.locals['payload'] = { data: results };
    return next();
  }),
  respond
);

export default router;
