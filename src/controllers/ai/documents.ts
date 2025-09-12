import express from 'express';
import asyncHandler from '../../helpers/utils/async-handler.js';
import { respond } from '../../middleware/respond.js';
import type { Request, Response } from 'express';
import {
  createDocumentSchema,
  updateDocumentSchema,
  listDocumentsSchema,
  createDocumentVersionSchema,
  generateSuggestionsSchema,
  getSuggestionsSchema,
} from './schemas/documents.schema.js';
import { isValidUuid } from '../../helpers/utils/is-valid-uuid.js';
import { InvalidPayloadError } from '../../helpers/errors/index.js';
import { DocumentService } from '../../services/ai/documents/application-content-service.js';

const router = express.Router();

/**
 * Create a new document
 * Compatible with Vercel AI SDK document creation
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response, next) => {
    // Validate request body
    const { error, value } = createDocumentSchema.validate(req.body);
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const document = await service.createDocument({
      ...value,
      created_by: accountability.user,
    });

    res.locals['payload'] = { data: document };
    return next();
  }),
  respond
);

/**
 * Get all documents for the authenticated user
 */
router.get(
  '/',
  asyncHandler(async (req: Request, res: Response, next) => {
    // Validate query parameters
    const { error, value } = listDocumentsSchema.validate(req.query);
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const documents = await service.getUserDocuments({
      userId: accountability.user,
      ...value.filter,
    });

    res.locals['payload'] = { data: documents };
    return next();
  }),
  respond
);

/**
 * Get a specific document by ID
 */
router.get(
  '/:documentId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const document = await service.getDocument(
      documentId,
      accountability.user
    );

    if (!document) {
      return res.status(404).json({
        errors: [{ message: 'Document not found' }],
      });
    }

    res.locals['payload'] = { data: document };
    return next();
  }),
  respond
);

/**
 * Update document content
 * Supports partial updates and creates versions
 */
router.patch(
  '/:documentId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    
    // Validate request body
    const { error, value } = updateDocumentSchema.validate(req.body);
    
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const updatedDocument = await service.updateDocument(
      documentId,
      value,
      accountability.user
    );

    if (!updatedDocument) {
      return res.status(404).json({
        errors: [{ message: 'Document not found' }],
      });
    }

    res.locals['payload'] = { data: updatedDocument };
    return next();
  }),
  respond
);

/**
 * Delete a document
 */
router.delete(
  '/:documentId',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    await service.deleteDocument(
      documentId,
      accountability.user
    );

    res.locals['payload'] = { data: { success: true } };
    return next();
  }),
  respond
);

/**
 * Create a new version of a document
 */
router.post(
  '/:documentId/versions',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    
    // Validate request body
    const { error, value } = createDocumentVersionSchema.validate(req.body);

    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const version = await service.createDocumentVersion(
      documentId,
      value,
      accountability.user
    );

    res.locals['payload'] = { data: version };
    return next();
  }),
  respond
);

/**
 * Get all versions of a document
 */
router.get(
  '/:documentId/versions',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const versions = await service.getDocumentVersions(
      documentId,
      accountability.user
    );

    res.locals['payload'] = { data: versions };
    return next();
  }),
  respond
);

/**
 * Generate AI suggestions for a document
 */
router.post(
  '/:documentId/suggestions',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    
    // Validate request body
    const { error, value } = generateSuggestionsSchema.validate(req.body);
   
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const suggestions = await service.generateSuggestions(
      documentId,
      value.type,
      accountability.user
    );

    res.locals['payload'] = { data: suggestions };
    return next();
  }),
  respond
);

/**
 * Get all suggestions for a document
 */
router.get(
  '/:documentId/suggestions',
  asyncHandler(async (req: Request, res: Response, next) => {
    const { documentId } = req.params;
    
    // Validate query parameters
    const { error, value } = getSuggestionsSchema.validate(req.query);
    if (error) {
      throw new InvalidPayloadError({ reason: error?.message })
    }

    const accountability = req.accountability;
    const schema = req.schema;

    if (!accountability?.user) {
      return res.status(401).json({
        errors: [{ message: 'Authentication required' }],
      });
    }

    if(!documentId || !isValidUuid(documentId)) {
      throw new InvalidPayloadError({ reason: "Document ID not provided or not valid"});
    }

    const service = new DocumentService({
      accountability,
      schema,
    });

    const suggestions = await service.getDocumentSuggestions(
      documentId,
      accountability.user,
      value
    );

    res.locals['payload'] = { data: suggestions };
    return next();
  }),
  respond
);

export default router;
