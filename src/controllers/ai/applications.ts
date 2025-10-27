import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { ApplicationCreationService } from '../../services/ai/applications/application-creation-service.js';
import { ItemsService } from '../../services/items.js';
import { respond } from '../../middleware/respond.js';
import type { Request, Response } from 'express';
import type { Accountability } from '../../types/accountability.js';
import type { SchemaOverview } from '../../types/schema.js';
import { ForbiddenError, InvalidPayloadError } from '../../helpers/errors/index.js';
import { isValidUuid } from '../../helpers/utils/is-valid-uuid.js';
import { createVersion } from '../../services/ai/tools/chat-tools.js';
import { createContentVersionSchema } from './schemas/applications.schema.js';

const router = express.Router();

/** 
 * Generate complete application documents with streaming response
 * This endpoint analyzes the grant and NGO, then generates all required documents
 * Compatible with Server-Sent Events (SSE) for real-time progress updates
 */
router.post(
  '/:applicationId/generate',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { applicationId } = req.params;

    // Validate application ID
    if (!applicationId || !isValidUuid(applicationId)) {
      throw new InvalidPayloadError({ reason: 'Application ID missing or not valid' });
    }

    // Ensure user is authenticated
    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const accountability = req.accountability as Accountability;
    const schema = req.schema as SchemaOverview;
    const userId = accountability.user as string;

    // Verify application exists and user has access using ItemsService
    const applicationsService = new ItemsService('applications', { accountability, schema });
    const application = await applicationsService.readOne(applicationId);

    // Check if application is already being generated
    const generationStatus = application['metadata']?.generation?.status;
    if (generationStatus === 'generating') {
      return res.status(409).json({
        errors: [{ message: 'Application generation already in progress' }],
      });
    }

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    // Initialize service
    const service = new ApplicationCreationService({
      accountability,
      schema,
    });

    // Start generation process (this handles its own response streaming)
    await service.generateApplication({
      applicationId,
      userId,
      stream: res,
      accountability,
      schema,
    });

    // The response is handled entirely by the service
    return next();
  })
);

/**
 * Cancel application generation (if in progress)
 */
router.post(
  '/:applicationId/cancel-generation',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { applicationId } = req.params;

    // Validate application ID
    if (!applicationId || !isValidUuid(applicationId)) {
      throw new InvalidPayloadError({ reason: 'Application ID missing or not valid' });
    }

    // Ensure user is authenticated
    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const userId = req.accountability.user as string;
    const accountability = req.accountability as Accountability;
    const schema = req.schema as SchemaOverview;

    // Get application using ItemsService
    const applicationsService = new ItemsService('applications', { accountability, schema });
    const application = await applicationsService.readOne(applicationId);

    // Check if generation is in progress
    const generationStatus = application['metadata']?.generation?.status;
    if (generationStatus !== 'generating') {
      return res.status(400).json({
        errors: [{ message: 'No generation in progress to cancel' }],
      });
    }

    // Update metadata to cancelled using ItemsService
    const metadata = application['metadata'] || {};
    metadata.generation = {
      ...metadata.generation,
      status: 'cancelled',
      cancelled_at: new Date(),
      cancelled_by: userId
    };

    await applicationsService.updateOne(applicationId, {
      metadata,
      updated_at: new Date()
    });

    res.locals['payload'] = {
      data: {
        application_id: applicationId,
        status: 'cancelled',
        message: 'Application generation cancelled successfully'
      }
    };

    return next();
  }),
  respond
);

/**
 * Retry failed application generation
 */
router.post(
  '/:applicationId/retry-generation',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { applicationId } = req.params;

    // Validate application ID
    if (!applicationId || !isValidUuid(applicationId)) {
      throw new InvalidPayloadError({ reason: 'Application ID missing or not valid' });
    }

    // Ensure user is authenticated
    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const accountability = req.accountability as Accountability;
    const schema = req.schema as SchemaOverview;
    const userId = accountability.user as string;

    // Check application status using ItemsService
    const applicationsService = new ItemsService('applications', { accountability, schema });
    const application = await applicationsService.readOne(applicationId);

    const generationStatus = application['metadata']?.generation?.status;
    if (generationStatus === 'generating') {
      return res.status(409).json({
        errors: [{ message: 'Application generation already in progress' }],
      });
    }

    if (generationStatus !== 'failed' && generationStatus !== 'cancelled') {
      return res.status(400).json({
        errors: [{ message: 'Can only retry failed or cancelled generations' }],
      });
    }

    // Reset generation status using ItemsService
    const metadata = application['metadata'] || {};
    metadata.generation = {
      ...metadata.generation,
      status: 'pending',
      progress: 0,
      current_phase: 'retrying',
      error: null,
      retried_at: new Date(),
      retried_by: userId
    };

    await applicationsService.updateOne(applicationId, {
      metadata,
      updated_at: new Date()
    });

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    // Initialize service and retry generation
    const service = new ApplicationCreationService({
      accountability,
      schema,
    });

    await service.generateApplication({
      applicationId,
      userId,
      stream: res,
      accountability,
      schema,
    });

    return next();
  })
);

/**
 * Manually create a version of application content
 * Used when users manually edit content on the frontend and want to save a version
 */
router.post(
  '/content/create-version',
  asyncHandler(async (req: Request, res: Response, next) => {

    // Validate request body
    const { error, value } = createContentVersionSchema.validate(req.body);

    if (error) {
      throw new InvalidPayloadError({ reason: error.details?.[0]?.message || 'Invalid request payload' });
    }

    const { application_id, content_id, change_description, content, content_blocks } = value;

    // Validate IDs
    if (!application_id || !isValidUuid(application_id)) {
      throw new InvalidPayloadError({ reason: 'Application ID missing or not valid' });
    }

    if (!content_id || !isValidUuid(content_id)) {
      throw new InvalidPayloadError({ reason: 'Document ID missing or not valid' });
    }

    // Ensure user is authenticated
    if (!req.accountability?.user) {
      throw new ForbiddenError();
    }

    const accountability = req.accountability as Accountability;
    const schema = req.schema as SchemaOverview;
    const userId = accountability.user as string;

    // Verify document exists and belongs to this application
    const contentService = new ItemsService('application_content', { accountability, schema });
    const document = await contentService.readOne(content_id);

    // Verify document belongs to this application
    if (document['application_id'] !== application_id) {
      throw new ForbiddenError();
    }

    // If content is provided, update the document first
    if (content) {
      const updates: any = {
        content,
        updated_at: new Date(),
        updated_by: userId,
      };

      // Update content_blocks if provided
      if (content_blocks !== undefined) {
        updates.content_blocks = content_blocks || [];
      }

      // Recalculate metadata
      updates.metadata = {
        ...document['metadata'],
        word_count: content.split(/\s+/).filter((word: string) => word.length > 0).length,
        character_count: content.length
      };

      await contentService.updateOne(content_id, updates);
    }

    // Read the current document state (either just updated or existing)
    const currentDocument = await contentService.readOne(content_id);

    // Create version with current state
    await createVersion(
      content_id,
      currentDocument['content'],
      currentDocument['content_blocks'] || [],
      change_description,
      userId,
      accountability,
      schema
    );

    res.locals['payload'] = { data: currentDocument };
    return next();
  }),
  respond
);

export default router;